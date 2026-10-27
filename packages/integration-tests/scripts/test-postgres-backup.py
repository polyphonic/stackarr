#!/usr/bin/env python3
"""Public backup policy and scheduling contracts; no database/network needed."""
import importlib.util
from pathlib import Path
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
import uuid


spec = importlib.util.spec_from_file_location('postgres_backup', Path(__file__).parents[3] / 'stackarr/scripts/postgres-backup.py')
assert spec and spec.loader
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class PolicyTests(unittest.TestCase):
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
