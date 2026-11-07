#!/usr/bin/env python3
"""Isolated database-bundle checks; never touches installed services."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest

MODULE = Path(__file__).resolve().parents[3] / 'stackarr/scripts/database-bundle.py'
spec = importlib.util.spec_from_file_location('database_bundle', MODULE)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

def source(engine, locator, checker=None):
    return dict(id='fixture', owner='fixture-service', engine=engine, locator=str(locator),
                checker=checker, passwordEnv=None, user='fixture' if engine in ('mysql', 'mariadb') else None,
                generation=None, dockerContainer=None)

def plan(s):
    return dict(sources=[s], exclusions=['fixture cache and images intentionally excluded'], inventoryNote='Fixture-owned explicit database inventory')

class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def test_live_wal_writer_and_source_unchanged(self):
        db = self.root / 'source.sqlite'
        conn = sqlite3.connect(db)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, text TEXT)')
        conn.execute("INSERT INTO items(text) VALUES ('initial')")
        conn.commit()

        stop = threading.Event()
        def writer():
            connection = sqlite3.connect(db, timeout=2)
            try:
                while not stop.is_set():
                    connection.execute("INSERT INTO items(text) VALUES ('during capture')")
                    connection.commit()
                    time.sleep(.005)
            finally:
                connection.close()
        worker = threading.Thread(target=writer)
        worker.start()
        try:
            result = b.capture(plan(source('sqlite', db)), self.root / 'bundle', timeout=10)
        finally:
            stop.set(); worker.join(timeout=3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(conn.execute("SELECT text FROM items WHERE id=1").fetchone(), ('initial',))
        self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone(), ('ok',))
        self.assertEqual(b.verify(self.root / 'bundle')['generation'], result['generation'])
        cli = subprocess.run([sys.executable, str(MODULE), 'verify', str(self.root/'bundle')], capture_output=True)
        self.assertEqual(cli.returncode, 0, cli.stderr)
        import gzip
        with gzip.open(self.root / 'bundle/component-0000.sqlite.gz', 'rb') as inp:
            (self.root / 'snapshot.sqlite').write_bytes(inp.read())
        snapshot = sqlite3.connect(self.root / 'snapshot.sqlite')
        self.assertGreaterEqual(snapshot.execute('SELECT count(*) FROM items').fetchone()[0], 1)
        self.assertEqual(snapshot.execute('PRAGMA integrity_check').fetchone(), ('ok',))
        snapshot.close(); conn.close()

    def test_corruption_traversal_symlink_and_optimized_python(self):
        db = self.root / 'source.sqlite'
        conn = sqlite3.connect(db); conn.execute('CREATE TABLE t(x)'); conn.commit(); conn.close()
        dest = self.root / 'bundle'
        b.capture(plan(source('sqlite', db)), dest)
        manifest = json.loads((dest/'manifest.json').read_text())
        manifest['components'][0]['file'] = '../escape'
        (dest/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(b.BundleError): b.verify(dest)
        result = subprocess.run([sys.executable, '-O', str(MODULE), 'verify', str(dest)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        manifest['components'][0]['file'] = 'component-0000.sqlite.gz'
        (dest/'manifest.json').write_text(json.dumps(manifest))
        artifact = dest / 'component-0000.sqlite.gz'
        artifact.write_bytes(artifact.read_bytes() + b'corrupt')
        with self.assertRaises(b.BundleError): b.verify(dest)
        artifact.unlink(); artifact.symlink_to(db)
        with self.assertRaises(b.BundleError): b.verify(dest)

    def test_missing_native_engine_and_checker_failure_are_fatal(self):
        import unittest.mock
        with unittest.mock.patch.object(b.shutil, 'which', return_value=None):
            with self.assertRaises(b.BundleError): b.capture(plan(source('mariadb', '127.0.0.1:3306')), self.root/'missing')
        self.assertFalse((self.root/'missing').exists())
        db = self.root/'plex.sqlite'
        conn = sqlite3.connect(db); conn.execute('CREATE TABLE t(x)'); conn.commit(); conn.close()
        checker = self.root/'checker'
        checker.write_text('#!/bin/sh\nexit 1\n'); checker.chmod(0o700)
        with self.assertRaises(b.BundleError): b.capture(plan(source('sqlite', db, str(checker))), self.root/'failed')
        self.assertFalse((self.root/'failed').exists())
        self.assertTrue(db.exists())
        s = source('mariadb', '127.0.0.1:3306')
        s['dockerContainer'] = 'stackarr-nonexistent-bundle-fixture'
        s['passwordEnv'] = 'BUNDLE_FIXTURE_SECRET'
        private = self.root/'plan.json'
        private.write_text(json.dumps(plan(s)))
        env = dict(os.environ, BUNDLE_FIXTURE_SECRET='fixture-secret-do-not-print')
        result = subprocess.run([sys.executable, str(MODULE), 'capture', str(private),
                                 str(self.root/'native-failed')], capture_output=True, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b'fixture-secret-do-not-print', result.stdout + result.stderr)
        self.assertFalse((self.root/'native-failed').exists())

    def test_source_unchanged_and_plex_requires_checker(self):
        db = self.root/'source.sqlite'
        conn = sqlite3.connect(db); conn.execute('CREATE TABLE t(x)'); conn.commit(); conn.close()
        before = db.read_bytes()
        b.capture(plan(source('sqlite', db)), self.root/'bundle')
        self.assertEqual(db.read_bytes(), before)
        plex = source('sqlite', db)
        plex['owner'] = 'plex-native'
        with self.assertRaises(b.BundleError): b.capture(plan(plex), self.root/'bad-plex')
        self.assertFalse((self.root/'bad-plex').exists())

    def test_malformed_plans_and_verification_manifest_fail_closed(self):
        db = self.root/'source.sqlite'
        conn = sqlite3.connect(db)
        conn.execute('CREATE TABLE t(x)')
        conn.commit(); conn.close()
        for field, value in [('engine', []), ('engine', {}), ('passwordEnv', 4),
                             ('dockerContainer', ['bad']), ('generation', {}), ('checker', ['bad'])]:
            s = source('sqlite', db)
            s[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(b.BundleError):
                b.checked_plan(plan(s))
        s = source('postgres', self.root)
        s['generation'] = []
        with self.assertRaises(b.BundleError): b.checked_plan(plan(s))
        m = b.capture(plan(source('sqlite', db)), self.root/'bundle')
        with self.assertRaises(b.BundleError):
            b.capture(plan(source('sqlite', self.root/'missing.sqlite')), self.root/'bundle')
        self.assertEqual(b.verify(self.root/'bundle'), m)
        self.assertEqual((self.root/'bundle').stat().st_mode & 0o077, 0)
        self.assertEqual((self.root/'bundle/manifest.json').stat().st_mode & 0o077, 0)
        for field, value in [('engine', []), ('generation', {}), ('dockerImageId', 'bad')]:
            altered = json.loads(json.dumps(m))
            (altered if field == 'generation' else altered['components'][0])[field] = value
            (self.root/'bundle/manifest.json').write_text(json.dumps(altered))
            with self.subTest(field=field), self.assertRaises(b.BundleError):
                b.verify(self.root/'bundle')
        # A checker path from a verification manifest must never run.
        altered = json.loads(json.dumps(m))
        altered['components'][0]['checker'] = str(self.root/'trap')
        (self.root/'bundle/manifest.json').write_text(json.dumps(altered))
        with self.assertRaises(b.BundleError): b.verify(self.root/'bundle')
        self.assertFalse((self.root/'trap').exists())

if __name__ == '__main__':
    unittest.main()
