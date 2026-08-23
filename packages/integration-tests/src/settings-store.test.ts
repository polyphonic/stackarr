import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const stackarrDbScript = path.join(repoRoot, 'stackarr/scripts/stackarr-db.cjs');
const commonScript = path.join(repoRoot, 'stackarr/lib/common.sh');

test('default database resolver uses the packaged data directory when present', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-settings-store-test-'));
  const dataDir = path.join(root, 'data');

  try {
    const { stdout } = await execFile(
      'bash',
      ['-c', 'source "$1"; default_stackarr_database_file', 'bash', commonScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATA_DIR: dataDir,
          STACKARR_DATABASE_FILE: ''
        }
      }
    );

    assert.equal(stdout.trim(), path.join(dataDir, 'config/stackarr.db'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('default database resolver keeps runtime state outside the source checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-settings-store-test-'));
  const appRoot = path.join(root, 'application-data');

  try {
    const { stdout } = await execFile(
      'bash',
      ['-c', 'source "$1"; default_stackarr_database_file', 'bash', commonScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          APP_ROOT: '',
          APP_ROOT_DEFAULT_OVERRIDE: appRoot,
          CONFIG_ROOT: '',
          STACKARR_DATA_DIR: '',
          STACKARR_DATABASE_FILE: ''
        }
      }
    );

    assert.equal(stdout.trim(), path.join(appRoot, 'config/stackarr.db'));
    assert.equal(stdout.includes(repoRoot), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('settings reads prefer the active Postgres store over the SQLite bootstrap copy', async () => {
  const fixture = await createFakePostgresFixture('stackarr.settings', { ui: { theme: 'light' } });
  const sqliteValue = JSON.stringify({ ui: { theme: 'dark' } });
  writeSqliteSetting(fixture.databaseFile, 'stackarr.settings', sqliteValue);

  try {
    const stackarrDb = requireFreshStackarrDb(fixture);
    const value = stackarrDb.readSetting('stackarr.settings');
    const log = await readFile(fixture.psqlLog, 'utf8');

    assert.equal(value, JSON.stringify({ ui: { theme: 'light' } }));
    assert.doesNotMatch(log, /insert into app_settings[\s\S]*stackarr\.settings[\s\S]*"dark"/);
  } finally {
    fixture.restoreEnv();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runtime config writes update only the active Postgres row when Postgres is configured', async () => {
  const fixture = await createFakePostgresFixture('stackarr.runtimeConfig', {
    STACKARR_WEB_PORT: '7580',
    KEEP: 'postgres'
  });
  writeSqliteSetting(
    fixture.databaseFile,
    'stackarr.runtimeConfig',
    JSON.stringify({ STACKARR_WEB_PORT: '7777', KEEP: 'sqlite' })
  );

  try {
    const stackarrDb = requireFreshStackarrDb(fixture);
    stackarrDb.writeSettings({ STACKARR_WEB_PORT: '7777' });
    const log = await readFile(fixture.psqlLog, 'utf8');

    assert.match(log, /insert into app_settings[\s\S]*STACKARR_WEB_PORT[\s\S]*7777/);
    assert.match(log, /insert into app_settings[\s\S]*KEEP[\s\S]*postgres/);
    assert.doesNotMatch(log, /insert into app_settings[\s\S]*KEEP[\s\S]*sqlite/);
    assert.equal(
      readSqliteSetting(fixture.databaseFile, 'stackarr.runtimeConfig'),
      JSON.stringify({
        STACKARR_WEB_PORT: '7777',
        KEEP: 'sqlite'
      })
    );
  } finally {
    fixture.restoreEnv();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runtime config reads do not promote SQLite bootstrap rows into Postgres', async () => {
  const fixture = await createFakePostgresFixture('stackarr.runtimeConfig');
  writeSqliteSetting(
    fixture.databaseFile,
    'stackarr.runtimeConfig',
    JSON.stringify({ STACKARR_WEB_PORT: '7777', KEEP: 'sqlite' })
  );

  try {
    const stackarrDb = requireFreshStackarrDb(fixture);
    const value = stackarrDb.readSetting('stackarr.runtimeConfig');
    const log = await readFile(fixture.psqlLog, 'utf8');

    assert.equal(value, undefined);
    assert.doesNotMatch(log, /insert into app_settings[\s\S]*KEEP[\s\S]*sqlite/);
  } finally {
    fixture.restoreEnv();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function writeSqliteSetting(databaseFile: string, key: string, value: string) {
  const db = new DatabaseSync(databaseFile);
  try {
    db.exec(`
      create table if not exists app_settings (
        key text primary key,
        value text not null,
        updated_at text not null default (datetime('now'))
      );
    `);
    db.prepare('insert into app_settings (key, value) values (?, ?)').run(key, value);
  } finally {
    db.close();
  }
}

function readSqliteSetting(databaseFile: string, key: string) {
  const db = new DatabaseSync(databaseFile);
  try {
    return (db.prepare('select value from app_settings where key = ?').get(key) as { value?: string } | undefined)
      ?.value;
  } finally {
    db.close();
  }
}

async function createFakePostgresFixture(settingKey: string, postgresValue?: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-settings-store-test-'));
  const binDir = path.join(root, 'bin');
  const psqlLog = path.join(root, 'psql.log');
  const databaseFile = path.join(root, 'stackarr.db');
  const hasPostgresValue = arguments.length > 1;
  await mkdir(binDir, { recursive: true });
  await writeFile(psqlLog, '');

  const fakePsql = path.join(binDir, 'psql');
  await writeFile(
    fakePsql,
    `#!/usr/bin/env node
const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_PSQL_LOG, input + '\\n---\\n');
if (${JSON.stringify(hasPostgresValue)} && input.includes("select value from app_settings where key = '${settingKey.replace(/'/g, "''")}'")) {
  process.stdout.write(${JSON.stringify(JSON.stringify(postgresValue))});
}
`
  );
  await chmod(fakePsql, 0o755);

  const previousEnv = {
    PATH: process.env.PATH,
    STACKARR_DATABASE_FILE: process.env.STACKARR_DATABASE_FILE,
    STACKARR_DATABASE_URL: process.env.STACKARR_DATABASE_URL,
    FAKE_PSQL_LOG: process.env.FAKE_PSQL_LOG
  };

  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.STACKARR_DATABASE_FILE = databaseFile;
  process.env.STACKARR_DATABASE_URL = 'postgres://stackarr:secret@database:5432/stackarr-main';
  process.env.FAKE_PSQL_LOG = psqlLog;

  return {
    root,
    databaseFile,
    psqlLog,
    restoreEnv() {
      restoreEnvValue('PATH', previousEnv.PATH);
      restoreEnvValue('STACKARR_DATABASE_FILE', previousEnv.STACKARR_DATABASE_FILE);
      restoreEnvValue('STACKARR_DATABASE_URL', previousEnv.STACKARR_DATABASE_URL);
      restoreEnvValue('FAKE_PSQL_LOG', previousEnv.FAKE_PSQL_LOG);
      delete require.cache[require.resolve(stackarrDbScript)];
    }
  };
}

function requireFreshStackarrDb(_fixture: { databaseFile: string }) {
  delete require.cache[require.resolve(stackarrDbScript)];
  return require(stackarrDbScript) as {
    readSetting(key: string): string | undefined;
    writeSettings(patch: Record<string, string>): string;
  };
}

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
