#!/usr/bin/env python3
"""Synthetic, offline tests: python3 packages/integration-tests/scripts/test-torrent-metadata-capture.py"""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[3] / 'stackarr/scripts/torrent-metadata-capture.py'
spec = importlib.util.spec_from_file_location('torrent_metadata_capture', SCRIPT)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def benc(value):
    if isinstance(value, int):
        return b'i%de' % value
    if isinstance(value, str):
        value = value.encode()
    if isinstance(value, bytes):
        return str(len(value)).encode() + b':' + value
    if isinstance(value, list):
        return b'l' + b''.join(benc(item) for item in value) + b'e'
    return b'd' + b''.join(benc(key) + benc(val) for key, val in sorted(value.items())) + b'e'


def fixture(v2=False, announce=b'https://private.invalid/passkey'):
    info = {b'name': b'fixture', b'piece length': 16384}
    if v2:
        info.update({b'meta version': 2, b'file tree': {b'video.mkv': {b'': {b'length': 1,
                         b'pieces root': b'0' * 32}}}})
        digest = hashlib.sha256(benc(info)).hexdigest().upper()
    else:
        info.update({b'length': 1, b'pieces': b'1' * 20})
        digest = hashlib.sha1(benc(info)).hexdigest().upper()
    return benc({b'announce': announce, b'info': info}), digest


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.archive = self.root / 'archive'
        self.transmission = self.root / 'transmission'
        self.qb = self.root / 'qb'
        for path in (self.archive, self.transmission, self.qb):
            path.mkdir()

    def scan(self):
        return module.capture_pass(self.archive, self.transmission, self.qb)

    def test_delayed_metadata_and_idempotent_exact_bytes(self):
        data, digest = fixture()
        candidate = self.transmission / ('release.' + digest.lower() + '.torrent')
        candidate.write_bytes(b'magnet:?xt=urn:btih:' + digest.encode())
        self.assertEqual(self.scan()['captured'], 0)
        candidate.write_bytes(data)
        self.assertEqual(self.scan()['captured'], 1)
        output = self.archive / '_Captured' / (digest + '.torrent')
        self.assertEqual(output.read_bytes(), data)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        candidate.unlink()
        self.assertEqual(self.scan()['captured'], 0)
        # Same infohash but different tracker: original capture remains immutable.
        altered, _ = fixture(announce=b'https://other.invalid/private')
        (self.qb / (digest.lower() + '.torrent')).write_bytes(altered)
        self.assertEqual(self.scan()['existing'], 1)
        self.assertEqual(output.read_bytes(), data)

    def test_v2_and_filename_mismatch(self):
        data, digest = fixture(v2=True)
        (self.qb / (digest.lower() + '.torrent')).write_bytes(data)
        self.assertEqual(self.scan()['captured'], 1)
        self.assertEqual((self.archive / '_Captured' / (digest + '.torrent')).read_bytes(), data)
        wrong = self.transmission / ('F' * 40 + '.torrent')
        wrong.write_bytes(fixture()[0])
        self.assertEqual(self.scan()['captured'], 0)
        self.assertFalse((self.archive / '_Captured' / ('F' * 40 + '.torrent')).exists())

    def test_malformed_duplicate_truncated_oversize_and_unready(self):
        valid, digest = fixture()
        info = benc({b'name': b'fixture', b'piece length': 16384, b'length': 1, b'pieces': b'1' * 20})
        invalid = (b'd4:info' + info + b'4:info' + info + b'e', valid[:-2],
                   b'x' * (module.MAX_TORRENT_BYTES + 1), b'd4:infodee')
        for candidate in invalid:
            with self.subTest(length=len(candidate)):
                with self.assertRaises(module.Unready):
                    module.torrent_hashes(candidate)
        path = self.qb / (digest + '.torrent')
        for candidate in invalid:
            path.write_bytes(candidate)
            self.assertEqual(self.scan()['captured'], 0)
        self.assertFalse((self.archive / '_Captured' / (digest + '.torrent')).exists())

    def test_source_and_target_symlinks_are_not_followed(self):
        data, digest = fixture()
        outside = self.root / 'outside'
        outside.write_bytes(data)
        (self.qb / (digest + '.torrent')).symlink_to(outside)
        self.assertEqual(self.scan()['captured'], 0)
        self.assertEqual(outside.read_bytes(), data)
        (self.qb / (digest + '.torrent')).unlink()
        (self.qb / (digest + '.torrent')).write_bytes(data)
        captured = self.archive / '_Captured'
        (captured / (digest + '.torrent')).symlink_to(outside)
        self.assertEqual(self.scan()['captured'], 0)
        self.assertEqual(outside.read_bytes(), data)
        (captured / (digest + '.torrent')).unlink()
        captured.rmdir()
        captured.symlink_to(self.root)
        with self.assertRaises(OSError):
            self.scan()
        captured.unlink()
        self.assertEqual(self.scan()['captured'], 1)

    def test_symlink_ancestor_and_missing_state(self):
        data, digest = fixture()
        (self.qb / (digest + '.torrent')).write_bytes(data)
        link = self.root / 'alias'
        link.symlink_to(self.archive)
        with self.assertRaises(OSError):
            module.capture_pass(link, self.transmission, self.qb)
        self.assertEqual(module.capture_pass(self.archive, self.root / 'missing', None)['skipped'], 1)
        self.assertEqual(self.scan()['captured'], 1)

    def test_invalid_existing_capture_is_not_replaced_and_private_directory_required(self):
        data, digest = fixture()
        (self.qb / (digest + '.torrent')).write_bytes(data)
        captured = self.archive / '_Captured'
        captured.mkdir(mode=0o700)
        target = captured / (digest + '.torrent')
        target.write_bytes(b'not metainfo')
        self.assertEqual(self.scan()['skipped'], 1)
        self.assertEqual(target.read_bytes(), b'not metainfo')
        captured.chmod(0o755)
        with self.assertRaises(PermissionError):
            self.scan()

    def test_cli_bounded_passes_no_secret_output(self):
        data, digest = fixture()
        (self.qb / (digest + '.torrent')).write_bytes(data)
        run = subprocess.run([sys.executable, str(SCRIPT), '--archive-root', str(self.archive),
                              '--qbittorrent-state', str(self.qb), '--passes', '2', '--interval', '0'],
                             text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('captured=1', run.stdout)
        self.assertIn('existing=1', run.stdout)
        self.assertNotIn('passkey', run.stdout + run.stderr)
        self.assertEqual((self.archive / '_Captured' / (digest + '.torrent')).read_bytes(), data)


if __name__ == '__main__':
    unittest.main()
