#!/usr/bin/env python3
"""Public backup policy and scheduling contracts; no database/network needed."""
import importlib.util
from pathlib import Path
import json
import fcntl
import tempfile
import unittest
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
import uuid
import subprocess
import os


spec = importlib.util.spec_from_file_location('postgres_backup', Path(__file__).parents[3] / 'stackarr/scripts/postgres-backup.py')
assert spec and spec.loader
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class PolicyTests(unittest.TestCase):
    def test_real_sqlite_loader_strict_backup_only_and_first_install(self):
        repo = Path(__file__).parents[3]
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'settings.sqlite'
            script = f'source "{repo}/stackarr/lib/common.sh"; ROOT_DIR="{repo}/stackarr"; default_stackarr_database_file() {{ printf "%s\\n" "$TEST_DB"; }}; load_sqlite_runtime_config "$1"'
            def load(strict='', root=None, node_path=None):
                command = script if root is None else script.replace(f'ROOT_DIR="{repo}/stackarr"', f'ROOT_DIR="{root}"')
                env = dict(os.environ, TEST_DB=str(db), STACKARR_DATABASE_URL='', STACKARR_DATABASE_FILE=str(db))
                if node_path is not None:
                    env['PATH'] = node_path
                return subprocess.run(['bash', '-c', command, 'fixture', strict], env=env, capture_output=True, text=True)
            self.assertEqual(load('strict').returncode, 0)  # no DB: first installation
            subprocess.run(['node', '-e', "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.exec('create table app_settings (key text primary key, value text, updated_at text)'); d.prepare('insert into app_settings values (?, ?, ?)').run('stackarr.runtimeConfig', process.argv[2], 'now'); d.close()", str(db), json.dumps({'POSTGRES_DEPLOYMENT_MODE': 'independent', 'STACKARR_PG_BACKUP_ENABLED': 'true', 'POSTGRES_HOST_PORT': '5434'})], check=True)
            self.assertNotEqual(load('strict').returncode, 0)
            self.assertEqual(load().returncode, 0)  # other callers preserve compatibility
            valid = dict(POSTGRES_DEPLOYMENT_MODE='independent', STACKARR_PG_BACKUP_ENABLED='true', POSTGRES_HOST_ADDRESS='localhost', POSTGRES_HOST_PORT='5434', POSTGRES_INSTANCE_ID='1234567890123456789', POSTGRES_HOST_CLIENT_BIN='/opt/pg/bin', DATABASE_SUPERUSER='admin', DATABASE_SUPERUSER_PASSWORD='fixture')
            subprocess.run(['node', '-e', "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.prepare('update app_settings set value=?').run(process.argv[2]); d.close()", str(db), json.dumps(valid)], check=True)
            self.assertEqual(load('strict').returncode, 0)
            self.assertNotEqual(load('strict', root=directory).returncode, 0)  # exporter missing
            with tempfile.TemporaryDirectory() as bin_dir:
                os.symlink('/bin/bash', Path(bin_dir) / 'bash')
                self.assertNotEqual(load('strict', node_path=bin_dir).returncode, 0)  # node missing
            subprocess.run(['node', '-e', "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.prepare('update app_settings set value=?').run('{broken'); d.close()", str(db)], check=True)
            self.assertNotEqual(load('strict').returncode, 0)
            subprocess.run(['node', '-e', "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.prepare('update app_settings set value=?').run('{}'); d.close()", str(db)], check=True)
            self.assertEqual(load('strict').returncode, 0)

    def test_manual_no_prune_publishes_without_deleting_retained_generations(self):
        class Cursor:
            def __init__(self):
                self.statements = []
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def execute(self, statement, _params=()):
                self.statements.append(statement)
            def fetchone(self):
                return ('existing-generation',)
            def copy_expert(self, *_):
                pass
        class Connection:
            def __init__(self):
                self.cur = Cursor()
                self.committed = False
            def cursor(self):
                return self.cur
            def commit(self):
                self.committed = True
        manifest = dict(format=1, generation=str(uuid.uuid4()), source={'databases': [{'name': 'postgres'}]},
                        artifacts=[dict(file='globals.sql', database=None, bytes=10, sha256='a'*64),
                                   dict(file='database-0000.dump', database='postgres', bytes=20, sha256='b'*64)])
        with patch.object(backup, 'preflight'), patch.object(backup, 'verify_remote'):
            for prune in (False, True):
                with self.subTest(prune=prune):
                    connection = Connection()
                    backup.publish(connection, Path('/unused'), manifest, retention=2, prune=prune)
                    statements = ' '.join(connection.cur.statements)
                    self.assertIn('UPDATE stackarr_backup_v1.identity SET current_generation', statements)
                    self.assertEqual('DELETE FROM stackarr_backup_v1.generations' in statements, prune)
                    self.assertTrue(connection.committed)

    def native_fixture(self, directory, **overrides):
        for tool in ('psql', 'pg_dump', 'pg_dumpall'):
            path = Path(directory) / tool
            path.write_text('#!/bin/sh\n')
            path.chmod(0o700)
        env = dict(POSTGRES_DEPLOYMENT_MODE='independent', POSTGRES_HOST_ADDRESS='127.0.0.1',
                   POSTGRES_HOST_PORT='5434', POSTGRES_INSTANCE_ID='1234567890123456789',
                   POSTGRES_HOST_CLIENT_BIN=directory, DATABASE_SUPERUSER='postgres',
                   DATABASE_SUPERUSER_PASSWORD='secret-that-must-not-appear')
        env.update(overrides)
        return env

    def test_native_source_pinned_configuration_and_client_version(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'bounded', return_value=b'pg_dump (PostgreSQL) 18.1 (Postgres.app)') as run:
            env = self.native_fixture(directory)
            source = backup.NativeSource(env)
            self.assertEqual(source.client_major, 18)
            self.assertEqual(run.call_count, 3)
            self.assertTrue(all(str(directory) in call.args[0][0] for call in run.call_args_list))
            self.assertTrue(all('secret-that-must-not-appear' not in str(call.args[0]) for call in run.call_args_list))
            self.assertNotIn('PGSERVICE', source.client_env)
            self.assertEqual(source.client_env['PGPASSFILE'], '/dev/null')
            with patch.dict('os.environ', {'PGSERVICE': 'evil', 'PGHOST': 'other', 'PGOPTIONS': '-c search_path=evil', 'PGPASSFILE': '/private/secret'}):
                clean = backup.NativeSource(env)
                self.assertNotIn('PGSERVICE', clean.client_env)
                self.assertEqual(clean.client_env['PGHOST'], '127.0.0.1')
                self.assertEqual(clean.client_env['PGPASSFILE'], '/dev/null')
                self.assertNotIn('evil', clean.client_env['PGOPTIONS'])
            with self.assertRaisesRegex(backup.BackupError, 'password'):
                backup.NativeSource(dict(env, DATABASE_SUPERUSER_PASSWORD=''))
            for change in (dict(POSTGRES_HOST_ADDRESS='host.docker.internal'), dict(POSTGRES_HOST_PORT='5432x'),
                           dict(POSTGRES_INSTANCE_ID=''), dict(POSTGRES_HOST_CLIENT_BIN='/missing'),
                           dict(POSTGRES_DEPLOYMENT_MODE='container')):
                with self.subTest(change=change), self.assertRaises(backup.BackupError):
                    backup.NativeSource(dict(env, **change))
            run.side_effect = [b'psql (PostgreSQL) 18.1', b'pg_dump (PostgreSQL) 17.9', b'pg_dumpall (PostgreSQL) 18.1']
            with self.assertRaisesRegex(backup.BackupError, 'versions disagree'):
                backup.NativeSource(env)

    def test_native_inventory_exclusion_evidence_and_changes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'bounded', return_value=b'psql (PostgreSQL) 18.1'):
            excluded = dict(name='disabled_fixture', owner='postgres', reason='failed new import; not recovery source')
            env = self.native_fixture(directory, STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS=json.dumps([excluded]))
            source = backup.NativeSource(env)
            rows = [dict(name=name, allowConnections=allowed, owner='postgres', bytes=1) for name, allowed in
                    [('app', True), ('postgres', True), ('template1', True), (excluded['name'], False)]]
            summary = dict(systemIdentifier=env['POSTGRES_INSTANCE_ID'], versionNum=180001, databases=rows)
            def query(sql, database=None):
                if 'pg_control_system()' in sql:
                    return summary
                return dict(schemas=[], extensions=[], largeObjects=0)
            source.query = query
            source.globals_fingerprint = lambda: 'fingerprint'
            inventory = source.inventory()
            self.assertEqual([d['name'] for d in inventory['databases']], ['app', 'postgres', 'template1'])
            self.assertEqual(inventory['excludedDatabases'][0]['reason'], excluded['reason'])
            for mutation in (lambda: summary.update(systemIdentifier='2345678901234567890'),
                             lambda: summary.update(versionNum=170001),
                             lambda: rows[-1].update(allowConnections=True),
                             lambda: rows[-1].update(owner='other')):
                with self.subTest(mutation=mutation):
                    mutation()
                    with self.assertRaises(backup.BackupError):
                        source.inventory()
                    summary['systemIdentifier'] = env['POSTGRES_INSTANCE_ID']
                    summary['versionNum'] = 180001
                    rows[-1].update(allowConnections=False, owner='postgres')
            rows.append(dict(name='unexpected', allowConnections=False, owner='postgres'))
            with self.assertRaisesRegex(backup.BackupError, 'Unapproved'):
                source.inventory()
            rows.pop()
            changed = json.loads(json.dumps(inventory))
            changed['excludedDatabases'][0]['owner'] = 'other'
            self.assertNotEqual(source._signature(changed), source._signature(inventory))
            source.inventory = lambda: changed
            with tempfile.TemporaryDirectory() as output, self.assertRaisesRegex(backup.BackupError, 'changed before capture'):
                source.capture(Path(output), inventory)
            source.inventory = lambda: inventory
            with patch.object(backup.Source, 'capture', return_value=[]):
                source.inventory = iter([inventory, dict(inventory, excludedDatabases=changed['excludedDatabases'])]).__next__
                with tempfile.TemporaryDirectory() as output, self.assertRaisesRegex(backup.BackupError, 'changed during capture'):
                    source.capture(Path(output), inventory)

    def test_source_mode_fails_closed_without_docker_fallback(self):
        self.assertEqual(backup.source_mode({}), 'managed')
        self.assertEqual(backup.source_mode({'POSTGRES_DEPLOYMENT_MODE': 'independent'}), 'independent')
        with self.assertRaisesRegex(backup.BackupError, 'capabilities are incomplete'):
            backup.source_mode({'POSTGRES_DEPLOYMENT_MODE': 'external'})
        for mode in ('unexpected', ''):
            with self.subTest(mode=mode), self.assertRaises(backup.BackupError):
                backup.source_mode({'POSTGRES_DEPLOYMENT_MODE': mode})

    def test_cli_rejects_missing_external_capabilities_before_clients_or_target(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.external_fixture(directory, STATE_ROOT=directory)
            for operation in ('test', 'run'):
                for field in ('HOST', 'PORT', 'INSTANCE_ID', 'CLIENT_BIN', 'CLIENT_MAJOR',
                              'USER', 'PASSWORD', 'TLS_MODE', 'TLS_ROOT_CERT'):
                    with self.subTest(operation=operation, missing=field), \
                         patch.dict('os.environ', dict(env, **{'STACKARR_PG_BACKUP_SOURCE_' + field: ''}), clear=True), \
                         patch.object(sys, 'argv', ['postgres-backup.py', operation]), \
                         patch.object(backup, 'bounded') as client, \
                         patch.object(backup, 'target') as target:
                        with self.assertRaisesRegex(backup.BackupError, 'capabilities are incomplete'):
                            backup.main()
                        client.assert_not_called()
                        target.assert_not_called()
            for mode in ('managed', 'independent', 'external', 'unexpected'):
                with self.subTest(mode=mode):
                    selected = dict(env, POSTGRES_DEPLOYMENT_MODE=mode)
                    if mode == 'unexpected':
                        with self.assertRaisesRegex(backup.BackupError, 'Unsupported PostgreSQL deployment mode'):
                            backup.source_mode(selected)
                    else:
                        self.assertEqual(backup.source_mode(selected), mode)

    def external_fixture(self, directory, **overrides):
        env = self.native_fixture(directory)
        ca = Path(directory) / 'ca.pem'
        ca.write_text('fixture CA')
        env.update(POSTGRES_DEPLOYMENT_MODE='external',
                   STACKARR_PG_BACKUP_SOURCE_HOST='db.example.test', STACKARR_PG_BACKUP_SOURCE_PORT='5432',
                   STACKARR_PG_BACKUP_SOURCE_INSTANCE_ID='1234567890123456789',
                   STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN=directory, STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR='18',
                   STACKARR_PG_BACKUP_SOURCE_USER='backup_owner', STACKARR_PG_BACKUP_SOURCE_PASSWORD='external-private',
                   STACKARR_PG_BACKUP_SOURCE_TLS_MODE='verify-full', STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT=str(ca))
        env.update(overrides)
        return env

    def test_external_capability_matrix_and_libpq_isolation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'bounded', return_value=b'psql (PostgreSQL) 18.1') as run:
            env = self.external_fixture(directory)
            self.assertEqual(backup.source_mode(env), 'external')
            with patch.dict('os.environ', {'PGSERVICE': 'hostile', 'PGHOSTADDR': '127.0.0.1',
                                            'PGSSLMODE': 'disable', 'PGOPTIONS': '-c search_path=evil',
                                            'PGPASSFILE': '/other/password'}):
                source = backup.ExternalSource(env)
            self.assertEqual(source.user, 'backup_owner')
            self.assertEqual(source.password, 'external-private')
            self.assertEqual(source.client_env['PGSSLMODE'], 'verify-full')
            self.assertEqual(source.client_env['PGSSLROOTCERT'], env['STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT'])
            self.assertEqual(source.client_env['PGCHANNELBINDING'], 'require')
            self.assertEqual(source.client_env['PGPASSFILE'], '/dev/null')
            self.assertNotIn('PGSERVICE', source.client_env)
            self.assertNotIn('PGHOSTADDR', source.client_env)
            self.assertEqual(run.call_count, 3)
            for key in ('HOST', 'PORT', 'INSTANCE_ID', 'CLIENT_BIN', 'CLIENT_MAJOR', 'USER', 'PASSWORD', 'TLS_MODE', 'TLS_ROOT_CERT'):
                with self.subTest(missing=key), self.assertRaisesRegex(backup.BackupError, 'capabilities are incomplete'):
                    backup.ExternalSource(dict(env, **{'STACKARR_PG_BACKUP_SOURCE_' + key: ''}))
            for change in (dict(STACKARR_PG_BACKUP_SOURCE_TLS_MODE='require'),
                           dict(STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT='/missing'),
                           dict(STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR='17'),
                           dict(STACKARR_PG_BACKUP_SOURCE_HOST='/socket'),
                           dict(STACKARR_PG_BACKUP_SOURCE_PORT='0'),
                           dict(STACKARR_PG_BACKUP_SOURCE_USER='bad user')):
                with self.subTest(change=change), self.assertRaises(backup.BackupError):
                    backup.ExternalSource(dict(env, **change))
            self.assertFalse(any('external-private' in str(call.args[0]) for call in run.call_args_list))

    def test_external_inventory_identity_and_quarantine_owner_drift(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'bounded', return_value=b'psql (PostgreSQL) 18.1'):
            policy = dict(name='disabled_fixture', owner='retired_owner', reason='not a recovery source')
            env = self.external_fixture(directory, STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS=json.dumps([policy]))
            source = backup.ExternalSource(env)
            rows = [dict(name=n, allowConnections=True, owner='backup_owner') for n in ('postgres', 'template1', 'app')]
            rows.append(dict(name='disabled_fixture', allowConnections=False, owner='retired_owner'))
            summary = dict(systemIdentifier=env['STACKARR_PG_BACKUP_SOURCE_INSTANCE_ID'], versionNum=180001, databases=rows)
            source.query = lambda sql, database=None: summary if 'pg_control_system()' in sql else dict(schemas=[], extensions=[], largeObjects=0)
            source.globals_fingerprint = lambda: 'fingerprint'
            inventory = source.inventory()
            self.assertEqual(len(inventory['excludedDatabases']), 1)
            for change in (dict(systemIdentifier='2345678901234567890'), dict(versionNum=170001)):
                with self.subTest(change=change), self.assertRaises(backup.BackupError):
                    source.query = lambda sql, database=None: dict(summary, **change) if 'pg_control_system()' in sql else dict(schemas=[], extensions=[], largeObjects=0)
                    source.inventory()
            source.query = lambda sql, database=None: summary if 'pg_control_system()' in sql else dict(schemas=[], extensions=[], largeObjects=0)
            rows[-1]['owner'] = 'other'
            with self.assertRaisesRegex(backup.BackupError, 'quarantine changed'):
                source.inventory()
            rows[-1]['owner'] = 'retired_owner'
            source.inventory = lambda: dict(inventory, systemIdentifier='2345678901234567890')
            with tempfile.TemporaryDirectory() as output, self.assertRaisesRegex(backup.BackupError, 'changed before capture'):
                source.capture(Path(output), inventory)

    def test_staging_must_remain_beneath_backup_root(self):
        with tempfile.TemporaryDirectory() as directory:
            backup_root = Path(directory).resolve() / 'backup'
            backup_root.mkdir()
            stage = backup.staging_directory({'BACKUP_ROOT': str(backup_root)})
            self.assertTrue(stage.is_relative_to(backup_root))
            with self.assertRaises(backup.BackupError):
                backup.staging_directory({'BACKUP_ROOT': str(backup_root), 'BACKUP_STAGING_ROOT': str(Path(directory) / 'elsewhere')})
            for bad in (str(backup_root / '..' / 'escape'), str(backup_root),
                        str(backup_root / 'nested' / '..' / 'stage')):
                with self.subTest(bad=bad), self.assertRaises(backup.BackupError):
                    backup.staging_directory({'BACKUP_ROOT': str(backup_root), 'BACKUP_STAGING_ROOT': bad})
            (backup_root / 'link').symlink_to(Path(directory))
            with self.assertRaises(backup.BackupError):
                backup.staging_directory({'BACKUP_ROOT': str(backup_root), 'BACKUP_STAGING_ROOT': str(backup_root / 'link' / 'stage')})
            with self.assertRaises(backup.BackupError):
                backup.staging_directory({'BACKUP_ROOT': str(backup_root / 'link')})
            with self.assertRaises(backup.BackupError):
                backup.staging_directory({'BACKUP_ROOT': str(backup_root / '..' / 'backup')})
            with self.assertRaises(backup.BackupError):
                backup.staging_directory({'BACKUP_ROOT': str(backup_root / 'missing')})
            nested = backup_root / 'nested'
            nested.mkdir()
            original = Path.stat
            actual = nested.stat()
            with patch.object(backup.Path, 'stat', autospec=True) as stat:
                stat.side_effect = lambda path, *a, **kw: type('Device', (), {'st_dev': actual.st_dev + 1})() if path == nested else original(path, *a, **kw)
                with self.assertRaises(backup.BackupError):
                    backup.checked_backup_path(backup_root, nested / 'stage')

    def test_native_sql_and_dump_command_contracts(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'bounded', return_value=b'psql (PostgreSQL) 18.1'):
            source = backup.NativeSource(self.native_fixture(directory))
            calls = []
            def execute(tool, args, **kwargs):
                calls.append((tool, args, kwargs))
                if tool == 'psql':
                    return b'"ok"'
                out = kwargs['output']
                out.write(b'PGDMPdata' if tool == 'pg_dump' else b'globals')
            source.execute = execute
            self.assertEqual(source.query('SELECT 1', 'app'), 'ok')
            source.query = lambda sql, database=None: ['app', 'postgres', 'template1'] if 'json_agg(datname' in sql else 'fingerprint'
            inventory = dict(databases=[dict(name=n) for n in ('app', 'postgres', 'template1')], globalsFingerprint='fingerprint')
            with tempfile.TemporaryDirectory() as output:
                artifacts = backup.Source.capture(source, Path(output), inventory)
                self.assertEqual(len(artifacts), 4)
            self.assertEqual([c[0] for c in calls], ['psql', 'pg_dumpall', 'pg_dump', 'pg_dump', 'pg_dump'])
            self.assertIn('--globals-only', calls[1][1])
            self.assertIn('-Fc', calls[2][1])
            self.assertIn('--create', calls[2][1])
            self.assertTrue(all('-w' in c[1] for c in calls))
            self.assertTrue(all('secret-that-must-not-appear' not in str(c[1]) for c in calls))

    def test_retention_bounds(self):
        self.assertEqual(backup.retention_count({}), 4)
        for count in ('2', '4', '30'):
            self.assertEqual(backup.retention_count({'STACKARR_PG_BACKUP_RETENTION_COUNT': count}), int(count))
        for count in ('', '1', '31', '4.0', '04', '-2'):
            with self.assertRaises(backup.BackupError):
                backup.retention_count({'STACKARR_PG_BACKUP_RETENTION_COUNT': count})

    def test_success_is_bound_to_target_and_source_not_only_schedule(self):
        env = dict(STACKARR_PG_BACKUP_ENABLED='true', STACKARR_PG_BACKUP_URL='postgresql://fixture:***@backup.example/recovery')
        now = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)
        status = dict(lastSuccess=now.isoformat(), targetIdentity=backup.target_identity(env), sourceIdentity=backup.source_identity(env))
        self.assertFalse(backup.due(env, status, now))
        self.assertTrue(backup.due(dict(env, STACKARR_PG_BACKUP_URL='postgresql://fixture:***@other.example/recovery'), status, now))
        self.assertEqual(backup.matching_status(dict(env, STACKARR_PG_BACKUP_URL='postgresql://fixture:***@other.example/recovery'), status), {})
        independent = dict(env, POSTGRES_DEPLOYMENT_MODE='independent', POSTGRES_HOST_ADDRESS='localhost', POSTGRES_HOST_PORT='5434', POSTGRES_INSTANCE_ID='1234567890123456789', POSTGRES_HOST_CLIENT_BIN='/opt/pg/bin', DATABASE_SUPERUSER='admin')
        previous = dict(status, sourceIdentity=backup.source_identity(independent))
        self.assertFalse(backup.due(independent, previous, now))
        changed = dict(independent, POSTGRES_INSTANCE_ID='2345678901234567890')
        self.assertTrue(backup.due(changed, previous, now))
        self.assertEqual(backup.matching_status(changed, previous), {})
        self.assertEqual(backup.matching_status(independent, dict(previous, sourceIdentity=None)), {})
        legacy = dict(status)
        del legacy['sourceIdentity']
        self.assertEqual(backup.matching_status(env, legacy), legacy)
        self.assertEqual(backup.matching_status(env, dict(status, sourceIdentity=None)), {})

    def test_abandoned_running_cache_is_not_an_active_job(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root/'status.json').write_text(json.dumps({'state': 'running', 'lastAttempt': '2025-01-01T00:00:00+00:00'}))
            self.assertEqual(backup.read_status(root)['state'], 'failed')
            with (root/'active.lock').open('w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertEqual(backup.read_status(root)['state'], 'running')

    def test_target_url_requires_safe_direct_verified_tls(self):
        result = backup.target_parameters('postgresql://backup:p%40ss@backup.example/recovery?sslmode=require&channel_binding=require')
        self.assertEqual(result['password'], 'p@ss')
        self.assertEqual(result['sslmode'], 'verify-full')
        for url in ['postgres://a:b@host/db?options=-csearch_path%3Devil', 'postgres://a:b@host/db?sslmode=disable',
                    'postgres://a:b@host/db?sslmode=require&sslmode=require', 'postgres://a:b@host/db#secret',
                    'postgres://a:b@host-pooler.example/db', 'postgres://a:b@host/db%0a',
                    'postgres://a:b@host/db?host=source', 'postgres://a:b@host/db%2Fx', 'postgres://a:%zz@host/db']:
            with self.subTest(url=url), self.assertRaises(backup.BackupError) as error:
                backup.target_parameters(url)
            self.assertNotIn(url, str(error.exception))

    def test_schedule_daily_weekly_dst_and_retry_catchup(self):
        at = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00'))
        env = dict(STACKARR_PG_BACKUP_ENABLED='true', STACKARR_PG_BACKUP_TIMEZONE='America/New_York',
                   STACKARR_PG_BACKUP_SCHEDULE='daily', STACKARR_PG_BACKUP_TIME='02:30')
        self.assertEqual(backup.schedule(env, at('2025-03-09T12:00:00Z')),
                         (at('2025-03-08T07:30:00Z'), at('2025-03-10T06:30:00Z')))
        env['STACKARR_PG_BACKUP_TIME'] = '01:30'
        self.assertEqual(backup.schedule(env, at('2025-11-02T06:45:00Z'))[0], at('2025-11-02T05:30:00Z'))
        env.update(STACKARR_PG_BACKUP_SCHEDULE='weekly', STACKARR_PG_BACKUP_WEEKDAY='Sun', STACKARR_PG_BACKUP_TIME='03:00')
        self.assertEqual(backup.schedule(env, at('2025-03-10T12:00:00Z')),
                         (at('2025-03-09T07:00:00Z'), at('2025-03-16T07:00:00Z')))
        env.update(STACKARR_PG_BACKUP_SCHEDULE='daily', STACKARR_PG_BACKUP_TIME='03:00')
        now = at('2025-03-12T12:00:00Z')
        self.assertTrue(backup.due(env, {'lastSuccess': '2025-03-09T07:00:00+00:00'}, now))
        self.assertFalse(backup.due(env, {'lastSuccess': '2025-03-09T07:00:00+00:00',
                                          'lastAttempt': '2025-03-12T11:30:00+00:00'}, now))
        self.assertTrue(backup.due(env, {'lastSuccess': '2025-03-09T07:00:00+00:00',
                                         'lastAttempt': '2025-03-12T10:59:59+00:00'}, now))
        env['STACKARR_PG_BACKUP_ENABLED'] = 'false'
        self.assertFalse(backup.due(env, {}, now))

    def test_malicious_manifest_rejected_without_leaking_values(self):
        source = {'databases': [{'name': 'postgres'}]}
        artifacts = [dict(file='globals.sql', database=None, bytes=10, sha256='a'*64),
                     dict(file='database-0000.dump', database='postgres', bytes=20, sha256='b'*64)]
        manifest = dict(format=1, generation=str(uuid.uuid4()), source=source, artifacts=artifacts)
        backup.validate_manifest(manifest)
        for change in [dict(format=2), dict(generation='not-a-uuid-secret'),
                       dict(artifacts=[artifacts[0], dict(artifacts[1], file='../secret')]),
                       dict(artifacts=[artifacts[0], dict(artifacts[1], sha256='secret')]),
                       dict(artifacts=[artifacts[0], dict(artifacts[1], database='other')])]:
            with self.subTest(change=change), self.assertRaises(backup.BackupError) as caught:
                backup.validate_manifest(dict(manifest, **change))
            self.assertEqual(str(caught.exception), 'Remote recovery manifest is invalid.')

if __name__ == '__main__':
    unittest.main()
