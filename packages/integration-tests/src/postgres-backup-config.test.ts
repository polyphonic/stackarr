import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
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
  postgresBackupTargetIdentity,
  protectedEnvConfigChanged,
  redactEnv,
  validatePostgresBackupConfig
} from '@stackarr/core';

const target =
  'postgresql://archive:really-secret@direct.example.invalid/archive?sslmode=verify-full&channel_binding=require';
const env = { ...managedEnvDefaults, STACKARR_PG_BACKUP_URL: target };

const externalSource = {
  ...env,
  POSTGRES_DEPLOYMENT_MODE: 'external',
  STACKARR_PG_BACKUP_ENABLED: 'true',
  STACKARR_PG_BACKUP_SOURCE_HOST: 'archive-source.example.invalid',
  STACKARR_PG_BACKUP_SOURCE_PORT: '5432',
  STACKARR_PG_BACKUP_SOURCE_INSTANCE_ID: '1234567890123456789',
  STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN: '/opt/pg18/bin',
  STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR: '18',
  STACKARR_PG_BACKUP_SOURCE_USER: 'archive_reader',
  STACKARR_PG_BACKUP_SOURCE_PASSWORD: 'fixture-secret-do-not-return',
  STACKARR_PG_BACKUP_SOURCE_TLS_MODE: 'verify-full',
  STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT: '/opt/ca/source.pem',
  STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS: ''
};

test('external source is opt-in, mode validated and never substituted with managed Docker', () => {
  assert.doesNotThrow(() => validatePostgresBackupConfig(externalSource));
  assert.doesNotThrow(() =>
    validatePostgresBackupConfig({
      ...env,
      POSTGRES_DEPLOYMENT_MODE: 'independent',
      STACKARR_PG_BACKUP_ENABLED: 'true'
    })
  );
  assert.throws(
    () => validatePostgresBackupConfig({ ...externalSource, STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR: '' }),
    /incomplete/
  );
  assert.throws(
    () => validatePostgresBackupConfig({ ...externalSource, POSTGRES_DEPLOYMENT_MODE: 'unsupported' }),
    /mode/
  );
  assert.throws(
    () => validatePostgresBackupConfig({ ...externalSource, STACKARR_PG_BACKUP_SOURCE_TLS_MODE: 'require' }),
    /verify-full/
  );
  assert.throws(
    () =>
      validatePostgresBackupConfig({
        ...externalSource,
        STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS: '[{"name":"postgres","owner":"x","reason":"x"}]'
      }),
    /exclusion/
  );
  assert.doesNotThrow(() =>
    validatePostgresBackupConfig({
      ...externalSource,
      STACKARR_PG_BACKUP_ENABLED: 'false',
      STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN: ''
    })
  );
  const publicConfig = postgresBackupPublicConfig(externalSource);
  assert.equal(publicConfig.STACKARR_PG_BACKUP_SOURCE_PASSWORD, '********');
  assert.equal(redactEnv(externalSource).STACKARR_PG_BACKUP_SOURCE_PASSWORD, '********');
  assert.equal(
    mergeEditableEnv(externalSource, { STACKARR_PG_BACKUP_SOURCE_PASSWORD: '********' })
      .STACKARR_PG_BACKUP_SOURCE_PASSWORD,
    externalSource.STACKARR_PG_BACKUP_SOURCE_PASSWORD
  );
  assert.equal(
    protectedEnvConfigChanged({ STACKARR_PG_BACKUP_SOURCE_HOST: 'replacement.example.invalid' }, externalSource),
    true
  );
  assert.equal(protectedEnvConfigChanged({ STACKARR_PG_BACKUP_SOURCE_PASSWORD: '********' }, externalSource), false);
  assert.equal(protectedEnvConfigChanged({ STACKARR_PG_BACKUP_SOURCE_PASSWORD: 'replacement' }, externalSource), true);
  assert.equal(
    mergeEditableEnv(env, { STACKARR_PG_BACKUP_SOURCE_HOST: 'source.example.invalid' }).STACKARR_PG_BACKUP_ENABLED,
    'false'
  );
});

test('external source paths allow spaces but reject relative paths and control characters', () => {
  for (const key of ['STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN', 'STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT']) {
    assert.doesNotThrow(() =>
      validatePostgresBackupConfig({
        ...externalSource,
        [key]: '/opt/Application Support/backup/source'
      })
    );
    for (const invalid of ['relative/source', '/opt/source\nfile', '/opt/source\u0000file', '/opt/source\tfile']) {
      assert.throws(() => validatePostgresBackupConfig({ ...externalSource, [key]: invalid }), /Invalid external/);
    }
  }
});

test('authoritative source write preserves secret and runtime export refuses incomplete enabled mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-pg-source-config-'));
  try {
    const db = path.join(root, 'settings.sqlite');
    const script = `
      import assert from 'node:assert/strict';
      import { readEnv, writeEnvConfig, postgresBackupPublicConfig } from '@stackarr/core';
      const source = ${JSON.stringify(Object.fromEntries(Object.entries(externalSource).filter(([key]) => key.startsWith('STACKARR_PG_BACKUP_') || key === 'POSTGRES_DEPLOYMENT_MODE')))};
      source.POSTGRES_HOST = 'db.example.invalid';
      source.POSTGRES_PORT = '5432';
      writeEnvConfig({ STACKARR_PG_BACKUP_SOURCE_HOST: source.STACKARR_PG_BACKUP_SOURCE_HOST });
      assert.equal(readEnv().STACKARR_PG_BACKUP_ENABLED, 'false');
      writeEnvConfig(source);
      assert.equal(readEnv().STACKARR_PG_BACKUP_SOURCE_PASSWORD, source.STACKARR_PG_BACKUP_SOURCE_PASSWORD);
      writeEnvConfig({ STACKARR_PG_BACKUP_SOURCE_PASSWORD: '********' });
      assert.equal(readEnv().STACKARR_PG_BACKUP_SOURCE_PASSWORD, source.STACKARR_PG_BACKUP_SOURCE_PASSWORD);
      assert.equal(postgresBackupPublicConfig(readEnv()).STACKARR_PG_BACKUP_SOURCE_PASSWORD, '********');
      assert.throws(() => writeEnvConfig({ STACKARR_PG_BACKUP_SOURCE_HOST: 'other.example.invalid' }), /Disable scheduled/);
      assert.equal(readEnv().STACKARR_PG_BACKUP_SOURCE_HOST, source.STACKARR_PG_BACKUP_SOURCE_HOST);
      assert.throws(() => writeEnvConfig({ STACKARR_PG_BACKUP_SOURCE_PORT: '' }), /Disable scheduled|incomplete/);
      assert.equal(readEnv().STACKARR_PG_BACKUP_SOURCE_PORT, source.STACKARR_PG_BACKUP_SOURCE_PORT);
    `;
    const childEnv = {
      ...process.env,
      STACKARR_DATABASE_FILE: db,
      STACKARR_DATABASE_MODE: 'sqlite',
      STACKARR_DATABASE_URL: ''
    };
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: childEnv,
      stdio: 'pipe'
    });
    const exporter = path.resolve(import.meta.dirname, '../../../stackarr/scripts/runtime-config-export.cjs');
    const output = execFileSync(process.execPath, [exporter], { env: childEnv, encoding: 'utf8' });
    assert.match(output, /export STACKARR_PG_BACKUP_SOURCE_PASSWORD=/);
    assert.match(output, /export STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS=/);
    assert.match(output, /export POSTGRES_DEPLOYMENT_MODE='external'/);
    const corrupt = `const { writeRawSetting } = require(${JSON.stringify(path.resolve(import.meta.dirname, '../../../stackarr/scripts/stackarr-db.cjs'))}); writeRawSetting('stackarr.runtimeConfig', JSON.stringify({POSTGRES_DEPLOYMENT_MODE:'external', STACKARR_PG_BACKUP_ENABLED:'true'}));`;
    execFileSync(process.execPath, ['-e', corrupt], { env: childEnv, stdio: 'pipe' });
    assert.throws(() => execFileSync(process.execPath, [exporter], { env: childEnv, stdio: 'pipe' }));
    const unknown = `const { writeRawSetting } = require(${JSON.stringify(path.resolve(import.meta.dirname, '../../../stackarr/scripts/stackarr-db.cjs'))}); writeRawSetting('stackarr.runtimeConfig', JSON.stringify({POSTGRES_DEPLOYMENT_MODE:'unknown', STACKARR_PG_BACKUP_ENABLED:'false'}));`;
    execFileSync(process.execPath, ['-e', unknown], { env: childEnv, stdio: 'pipe' });
    assert.throws(() => execFileSync(process.execPath, [exporter], { env: childEnv, stdio: 'pipe' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test('saved target preview masks only the password for supported URLs and fails closed otherwise', () => {
  const raw =
    'postgresql://user:p%40%3A%2F%23%3F%26%25@direct.example.invalid:5433/archive?sslmode=verify-full&channel_binding=require';
  const publicConfig = postgresBackupPublicConfig({ ...env, STACKARR_PG_BACKUP_URL: raw });
  assert.equal(publicConfig.STACKARR_PG_BACKUP_URL, '********');
  assert.equal(
    publicConfig.targetUrlPreview,
    'postgresql://user:********@direct.example.invalid:5433/archive?sslmode=verify-full&channel_binding=require'
  );
  assert.ok(!JSON.stringify(publicConfig).includes('p%40%3A%2F%23%3F%26%25'));
  for (const unsafe of [
    'postgresql://user:secret@host/db?token=alsosecret',
    'postgresql://user:secret@host/db#secret',
    'postgresql://user:secret@host-pooler.invalid/db',
    'postgresql://user:secret@host/db?sslmode=require&sslmode=verify-full',
    'postgresql://user:secret@host/%ZZ',
    'postgresql://user:secret@host/db?sslmode=require&',
    'postgresql://user:secret@host/db%2Fsecret',
    'https://user:secret@host/db'
  ]) {
    const result = postgresBackupPublicConfig({ ...env, STACKARR_PG_BACKUP_URL: unsafe });
    assert.equal(result.STACKARR_PG_BACKUP_URL, '********');
    assert.equal(result.targetUrlPreview, 'Saved secret');
    assert.ok(!JSON.stringify(result).includes('user:secret'));
    assert.ok(!JSON.stringify(result).includes('alsosecret'));
  }
  assert.equal(postgresBackupPublicConfig({ ...env, STACKARR_PG_BACKUP_URL: '' }).targetUrlPreview, '');
});

test('retention is bounded in the authoritative merged configuration', () => {
  assert.equal(managedEnvDefaults.STACKARR_PG_BACKUP_RETENTION_COUNT, '4');
  for (const count of ['2', '4', '30'])
    assert.doesNotThrow(() => validatePostgresBackupConfig({ ...env, STACKARR_PG_BACKUP_RETENTION_COUNT: count }));
  for (const count of ['', '0', '1', '31', '4.0', '04', '-2', '4 '])
    assert.throws(
      () => validatePostgresBackupConfig({ ...env, STACKARR_PG_BACKUP_RETENTION_COUNT: count }),
      /retention/
    );
  assert.equal(postgresBackupPublicConfig(env).STACKARR_PG_BACKUP_RETENTION_COUNT, '4');
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
        targetIdentity: postgresBackupTargetIdentity(env),
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
    const changedTarget = getPostgresBackupStatusAction({
      ...configured,
      STACKARR_PG_BACKUP_URL: 'postgresql://fixture:synthetic@other.invalid/recovery'
    });
    assert.equal(changedTarget.lastSuccess, null);
    assert.equal(changedTarget.generation, null);
    assert.deepEqual(changedTarget.coverage, []);
    fs.writeFileSync(file, JSON.stringify({ state: 'running', targetIdentity: postgresBackupTargetIdentity(env) }));
    assert.equal(getPostgresBackupStatusAction(configured).state, 'failed');
    assert.equal(nextPostgresBackupRun({ ...configured, STACKARR_PG_BACKUP_ENABLED: 'false' }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('status uses the real local lock and shares target identity with the engine', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-pg-active-'));
  const state = path.join(root, 'postgres-backup');
  fs.mkdirSync(state);
  const child = spawn('python3', [
    '-u',
    '-c',
    'import fcntl,sys,time; f=open(sys.argv[1],"w"); fcntl.flock(f,fcntl.LOCK_EX); print("locked",flush=True); time.sleep(20)',
    path.join(state, 'active.lock')
  ]);
  try {
    await once(child.stdout, 'data');
    fs.writeFileSync(
      path.join(state, 'status.json'),
      JSON.stringify({ state: 'running', targetIdentity: postgresBackupTargetIdentity(env) })
    );
    assert.equal(getPostgresBackupStatusAction({ ...env, STATE_ROOT: root }).state, 'running');
    child.kill('SIGTERM');
    await once(child, 'exit');
    assert.equal(getPostgresBackupStatusAction({ ...env, STATE_ROOT: root }).state, 'failed');
    const identity = execFileSync(
      'python3',
      [
        '-c',
        'import os,runpy,sys; print(runpy.run_path(sys.argv[1])["target_identity"](os.environ))',
        path.resolve(import.meta.dirname, '../../../stackarr/scripts/postgres-backup.py')
      ],
      { env: { ...process.env, STACKARR_PG_BACKUP_URL: target }, encoding: 'utf8' }
    );
    assert.equal(identity.trim(), postgresBackupTargetIdentity(env));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
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
      assert.throws(() => writeEnvConfig({ STACKARR_PG_BACKUP_RETENTION_COUNT: '31' }), /retention/);
      assert.equal(readEnv().STACKARR_PG_BACKUP_RETENTION_COUNT, '4');
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
