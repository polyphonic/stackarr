import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  commandRegistry,
  getPostgresBackupStatusAction,
  managedEnvDefaults,
  mergeEditableEnv,
  nextPostgresBackupRun,
  postgresBackupPublicConfig,
  redactEnv,
  validatePostgresBackupConfig
} from '@stackarr/core';

const target =
  'postgresql://archive:really-secret@direct.example.invalid/archive?sslmode=verify-full&channel_binding=require';
const env = { ...managedEnvDefaults, STACKARR_PG_BACKUP_URL: target };

test('target validation is strict and never echoes credentials', () => {
  validatePostgresBackupConfig(env);
  for (const raw of [
    'http://archive:secret@host/db',
    'postgresql://host/db',
    'postgresql://user@host/db',
    'postgresql://user:secret@host/',
    'postgresql://user:secret@host/db#fragment',
    'postgresql://user:secret@host/db?sslmode=disable',
    'postgresql://user:secret@host/db?sslmode=require&sslmode=verify-full',
    'postgresql://user:secret@host/db?application_name=app',
    'postgresql://user:secret@host-pooler.example/db',
    'postgresql://user:***@host/db\n',
    'postgresql://user:***@host/%ZZ',
    'postgresql://user:***@host/db?sslmode=require%',
    'postgresql://user:***@host/db?sslmode=require&',
    'postgresql://user:***@host/db?sslmode=',
    'postgresql://user:***@host/db?sslmode=require&sslmode=require',
    'postgresql://user:***@host,other/db',
    'postgresql://user:***@host%2Cother/db',
    'postgresql://user:%0A@host/db',
    'postgresql://user:***@host/%0A',
    'postgresql://user:***@/db',
    'postgresql://:***@host/db',
    'postgresql://user:@host/db'
  ]) {
    assert.throws(
      () => validatePostgresBackupConfig({ ...env, STACKARR_PG_BACKUP_URL: raw }),
      (error: Error) => !error.message.includes('secret') && !error.message.includes(raw)
    );
  }
  assert.throws(() =>
    validatePostgresBackupConfig({ ...env, STACKARR_PG_BACKUP_ENABLED: 'true', STACKARR_PG_BACKUP_URL: '' })
  );
  assert.throws(() => validatePostgresBackupConfig({ ...env, STACKARR_PG_BACKUP_TIMEZONE: 'Bad/Zone' }));
  assert.doesNotThrow(() =>
    validatePostgresBackupConfig({ ...env, STACKARR_PG_BACKUP_URL: 'postgres://user:secret@host/db?sslmode=require' })
  );
});

test('public config redacts the entire URL and redacted updates preserve it', () => {
  const redacted = redactEnv(env);
  assert.equal(redacted.STACKARR_PG_BACKUP_URL, '********');
  assert.equal(postgresBackupPublicConfig(env).STACKARR_PG_BACKUP_URL, '********');
  assert.equal(mergeEditableEnv(env, { STACKARR_PG_BACKUP_URL: '********' }).STACKARR_PG_BACKUP_URL, target);
});

test('cached status never connects and schedule respects local weekday', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-pg-backup-'));
  try {
    const file = path.join(root, 'postgres-backup', 'status.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(
      file,
      JSON.stringify({
        state: 'succeeded',
        lastAttempt: '2026-01-01T00:01:00Z',
        lastSuccess: '2026-01-01T00:00:00Z',
        coverage: [{ name: 'app', schema: 'public', extensions: ['vector', 'postgis'] }],
        lastError: `Connection failed: ${target}`
      })
    );
    const configured = {
      ...env,
      STATE_ROOT: root,
      STACKARR_PG_BACKUP_ENABLED: 'true',
      STACKARR_PG_BACKUP_SCHEDULE: 'weekly',
      STACKARR_PG_BACKUP_WEEKDAY: 'Sun',
      STACKARR_PG_BACKUP_TIME: '03:00'
    };
    const status = getPostgresBackupStatusAction(configured, new Date('2026-01-03T12:00:00Z'));
    assert.equal(status.state, 'succeeded');
    assert.equal(status.lastAttempt, '2026-01-01T00:01:00Z');
    assert.deepEqual(status.coverage, [{ name: 'app', schema: 'public', extensions: ['vector', 'postgis'] }]);
    assert.equal(status.lastError, 'Backup failed; inspect local backup logs.');
    assert.equal(status.nextRun, '2026-01-04T03:00:00.000Z');
    assert.equal(nextPostgresBackupRun({ ...configured, STACKARR_PG_BACKUP_ENABLED: 'false' }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('command definitions queue only dedicated backup subcommands', () => {
  assert.deepEqual(commandRegistry.PostgresBackupTest.args, ['postgres-backup', 'test']);
  assert.deepEqual(commandRegistry.PostgresBackupSync.args, ['postgres-backup', 'run']);
});

test('weekly local schedule skips a nonexistent DST hour', () => {
  const configured = {
    ...env,
    STACKARR_PG_BACKUP_ENABLED: 'true',
    STACKARR_PG_BACKUP_SCHEDULE: 'weekly',
    STACKARR_PG_BACKUP_WEEKDAY: 'Sun',
    STACKARR_PG_BACKUP_TIME: '02:30',
    STACKARR_PG_BACKUP_TIMEZONE: 'America/New_York'
  };
  assert.equal(nextPostgresBackupRun(configured, new Date('2026-03-08T06:00:00Z')), '2026-03-15T06:30:00.000Z');
});

test('local schedule runs a fall-back hour only on its first occurrence', () => {
  const configured = {
    ...env,
    STACKARR_PG_BACKUP_ENABLED: 'true',
    STACKARR_PG_BACKUP_SCHEDULE: 'daily',
    STACKARR_PG_BACKUP_TIME: '01:30',
    STACKARR_PG_BACKUP_TIMEZONE: 'America/New_York'
  };
  assert.equal(nextPostgresBackupRun(configured, new Date('2026-11-01T05:20:00Z')), '2026-11-01T05:30:00.000Z');
  assert.equal(nextPostgresBackupRun(configured, new Date('2026-11-01T05:40:00Z')), '2026-11-02T06:30:00.000Z');
});

test('authoritative merged writes reject invalid backup and RomM settings atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-pg-config-'));
  try {
    const script = `
      import assert from 'node:assert/strict';
      import { readEnv, writeEnvConfig } from '@stackarr/core';
      const before = readEnv();
      assert.throws(() => writeEnvConfig({ STACKARR_PG_BACKUP_ENABLED: 'true' }), /target URL/);
      assert.equal(readEnv().STACKARR_PG_BACKUP_ENABLED, before.STACKARR_PG_BACKUP_ENABLED);
      assert.throws(() => writeEnvConfig({ ROMM_WEB_SERVER_CONCURRENCY: '17' }), /1 to 16/);
      assert.equal(readEnv().ROMM_WEB_SERVER_CONCURRENCY, before.ROMM_WEB_SERVER_CONCURRENCY);
      writeEnvConfig({ STACKARR_PG_BACKUP_URL: 'postgres://u:p@direct.example.invalid/backup', STACKARR_PG_BACKUP_ENABLED: 'true' });
      assert.equal(readEnv().STACKARR_PG_BACKUP_ENABLED, 'true');
      assert.throws(() => writeEnvConfig({ STACKARR_PG_BACKUP_TIME: '25:00' }), /backup time/);
      assert.equal(readEnv().STACKARR_PG_BACKUP_TIME, '03:00');
    `;
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        STACKARR_DATABASE_FILE: path.join(root, 'settings.sqlite'),
        STACKARR_DATABASE_MODE: 'sqlite'
      },
      stdio: 'pipe'
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
