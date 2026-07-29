import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commonScript = path.join(repoRoot, 'stackarr/lib/common.sh');

test('compose env generation preserves runtime roots and the release image', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-compose-env-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const mediaRoot = '/mnt/stackarr-media';

  try {
    await execFile('bash', ['-c', 'source "$1"; load_env; write_compose_env_file', 'bash', commonScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_ROOT: path.join(root, 'app'),
        CONFIG_ROOT: path.join(root, 'app/config'),
        STATE_ROOT: path.join(root, 'app/state'),
        LOG_ROOT: path.join(root, 'app/logs'),
        MEDIA_ROOT: mediaRoot,
        MUSIC_ROOT: `${mediaRoot}/Music`,
        DOWNLOADS_ROOT: `${mediaRoot}/Downloads`,
        BACKUP_ROOT: `${mediaRoot}/Backups/Plex`,
        STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        STACKARR_IMAGE: 'polyphonic/stackarr:alpha',
        STACKARR_WEB_ENABLED: 'true',
        STACKARR_RUNTIME: 'docker-updater',
        STACKARR_RUN_SOURCE: 'web',
        STACKARR_CHANNEL: 'alpha',
        STACKARR_VERSION: 'fixture-version',
        STACKARR_REVISION: 'fixture-revision',
        STACKARR_SCHEDULER_ENABLED: 'true',
        STACKARR_COMPOSE_PROJECT_DIR: path.join(root, 'transient-compose'),
        STACKARR_COMPOSE_FILE: path.join(root, 'transient-compose/docker-compose.yml'),
        STACKARR_TASK_ID: 'transient-task-id',
        STACKARR_UPDATE_TASK_ID: 'transient-update-task-id',
        STACKARR_REPO_ROOT: '/app',
        PASSWORD: 'Portable435',
        UNRELATED_SECRET: 'should-not-be-written'
      }
    });

    const content = await readFile(composeEnvFile, 'utf8');
    const mode = (await stat(composeEnvFile)).mode & 0o777;

    assert.equal(mode, 0o600);
    assert.match(content, /^MEDIA_ROOT="\/mnt\/stackarr-media"$/m);
    assert.match(content, /^MUSIC_ROOT="\/mnt\/stackarr-media\/Music"$/m);
    assert.match(content, /^DOWNLOADS_ROOT="\/mnt\/stackarr-media\/Downloads"$/m);
    assert.match(content, /^BACKUP_ROOT="\/mnt\/stackarr-media\/Backups\/Plex"$/m);
    assert.match(content, /^STACKARR_IMAGE="polyphonic\/stackarr:alpha"$/m);
    assert.match(content, /^TRANSMISSION_PASSWORD="Portable435"$/m);
    const databasePassword = content.match(/^DATABASE_SUPERUSER_PASSWORD="([^"]+)"$/m)?.[1];
    assert.ok(databasePassword);
    assert.notEqual(databasePassword, 'Portable435');
    assert.doesNotMatch(
      content,
      /STACKARR_(?:CHANNEL|COMPOSE_FILE|COMPOSE_PROJECT_DIR|REVISION|RUNTIME|RUN_SOURCE|SCHEDULER_ENABLED|TASK_ID|UPDATE_TASK_ID|REPO_ROOT|VERSION)/
    );
    assert.doesNotMatch(content, /UNRELATED_SECRET/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compose env generation preserves passwords with shell and URL punctuation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-compose-env-special-password-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const password = `space $dollar $$pair 'single' "double" :/@\\ unicode-✓`;

  try {
    await execFile('bash', ['-c', 'source "$1"; load_env; write_compose_env_file', 'bash', commonScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_ROOT: path.join(root, 'app'),
        CONFIG_ROOT: path.join(root, 'app/config'),
        STATE_ROOT: path.join(root, 'app/state'),
        LOG_ROOT: path.join(root, 'app/logs'),
        STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        PASSWORD: password
      }
    });

    const content = await readFile(composeEnvFile, 'utf8');
    assert.match(content, /^PASSWORD="space \$\$dollar \$\$\$\$pair/m);

    const { stdout } = await execFile(
      'bash',
      ['-c', 'source "$1"; load_compose_runtime_env; printf "%s" "$PASSWORD"', 'bash', commonScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PASSWORD: '',
          STACKARR_COMPOSE_ENV_FILE: composeEnvFile
        }
      }
    );

    assert.equal(stdout, password);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Questarr inherits RomM IGDB credentials and portable game paths at runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-questarr-env-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const appRoot = path.join(root, 'app');

  try {
    await execFile('bash', ['-c', 'source "$1"; load_env; write_compose_env_file', 'bash', commonScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_ROOT: appRoot,
        CONFIG_ROOT: path.join(appRoot, 'config'),
        STATE_ROOT: path.join(appRoot, 'state'),
        LOG_ROOT: path.join(appRoot, 'logs'),
        MEDIA_ROOT: path.join(appRoot, 'media'),
        GAMES_ROOT: path.join(appRoot, 'media/Games'),
        ROMM_LIBRARY_ROOT: path.join(appRoot, 'media/Games'),
        ROMM_IGDB_CLIENT_ID: 'shared-client',
        ROMM_IGDB_CLIENT_SECRET: 'shared-secret',
        ENABLE_QUESTARR: 'true',
        STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db')
      }
    });

    const content = await readFile(composeEnvFile, 'utf8');
    assert.match(content, /^ENABLE_QUESTARR="true"$/m);
    assert.match(content, new RegExp(`^QUESTARR_DATA_ROOT="${path.join(appRoot, 'config/questarr')}"$`, 'm'));
    assert.match(content, new RegExp(`^QUESTARR_LIBRARY_ROOT="${path.join(appRoot, 'media/Games')}"$`, 'm'));
    assert.match(content, /^QUESTARR_SQLITE_DB_PATH="\/app\/data\/sqlite.db"$/m);
    assert.match(content, /^QUESTARR_IGDB_CLIENT_ID="shared-client"$/m);
    assert.match(content, /^QUESTARR_IGDB_CLIENT_SECRET="shared-secret"$/m);
    assert.match(content, /^QUESTARR_JWT_SECRET="[A-Za-z0-9]{32}"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compose env generation keeps legacy Postgres data directory when present', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-compose-env-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const legacyPgdata = path.join(configRoot, 'database/18/docker');

  try {
    await mkdir(legacyPgdata, { recursive: true });
    await writeFile(path.join(legacyPgdata, 'PG_VERSION'), '18\n');

    await execFile('bash', ['-c', 'source "$1"; load_env; write_compose_env_file', 'bash', commonScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_ROOT: appRoot,
        CONFIG_ROOT: configRoot,
        STATE_ROOT: path.join(appRoot, 'state'),
        LOG_ROOT: path.join(appRoot, 'logs'),
        STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db')
      }
    });

    const content = await readFile(composeEnvFile, 'utf8');

    assert.match(content, /^DATABASE_PGDATA="\/var\/lib\/postgresql\/18\/docker"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compose env can bootstrap Postgres mode without a SQLite config file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-compose-env-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const missingDatabaseFile = path.join(root, 'missing-stackarr.db');
  const binDir = path.join(root, 'bin');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, 'psql'), '#!/bin/sh\nexit 1\n');
    await writeFile(path.join(binDir, 'docker'), '#!/bin/sh\nexit 1\n');
    await chmod(path.join(binDir, 'psql'), 0o755);
    await chmod(path.join(binDir, 'docker'), 0o755);

    await writeFile(
      composeEnvFile,
      [
        '# Generated by Stackarr. Do not commit this file.',
        'STACKARR_DATABASE_URL="postgres://stackarr:secret@database:5432/stackarr-main"',
        'STACKARR_LOG_DATABASE_URL="postgres://stackarr:secret@database:5432/stackarr-log"',
        'STACKARR_DATABASE_MODE="postgres"',
        'STACKARR_SERVICE_URL_MODE="portless"',
        'STACKARR_SERVICE_URL_SCHEME="https"',
        'STACKARR_SERVICE_URL_HOST_SUFFIX="homelab"',
        'ENABLE_MAINTAINERR="false"',
        ''
      ].join('\n')
    );

    const { stdout } = await execFile(
      'bash',
      [
        '-c',
        'source "$1"; load_env; printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$STACKARR_DATABASE_MODE" "$STACKARR_DATABASE_URL" "$ENABLE_MAINTAINERR" "$STACKARR_SERVICE_URL_MODE" "$STACKARR_SERVICE_URL_HOST_SUFFIX"',
        'bash',
        commonScript
      ],
      {
        cwd: repoRoot,
        env: {
          PATH: `${binDir}:${process.env.PATH}`,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
          STACKARR_DATABASE_FILE: missingDatabaseFile,
          DATABASE_SUPERUSER_PASSWORD: 'secret',
          STACKARR_POSTGRES_PASSWORD: 'secret',
          PASSWORD: 'secret'
        }
      }
    );

    assert.equal(
      stdout,
      'postgres\npostgres://stackarr:secret@database:5432/stackarr-main\nfalse\nportless\nhomelab\n'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime config export carries Cleanuparr settings into managed Compose', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cleanuparr-export-test-'));
  const databaseFile = path.join(root, 'stackarr.db');
  const patchFile = path.join(root, 'runtime-config.json');
  const writer = path.join(repoRoot, 'stackarr/scripts/runtime-config-write.cjs');
  const exporter = path.join(repoRoot, 'stackarr/scripts/runtime-config-export.cjs');

  try {
    await writeFile(
      patchFile,
      JSON.stringify({
        ENABLE_CLEANUPARR: 'true',
        CLEANUPARR_URL: 'http://127.0.0.1:11011',
        CLEANUPARR_IMAGE: 'ghcr.io/cleanuparr/cleanuparr:latest',
        CLEANUPARR_BIND_IP: '127.0.0.1',
        CLEANUPARR_PORT: '11011',
        CLEANUPARR_AUTO_CONFIGURE: 'true',
        CLEANUPARR_MALWARE_CRON: '0/5 * * * * ?'
      })
    );
    await execFile(process.execPath, [writer, patchFile], {
      cwd: repoRoot,
      env: { ...process.env, STACKARR_DATABASE_FILE: databaseFile, STACKARR_DATABASE_URL: '' }
    });

    const { stdout } = await execFile(process.execPath, [exporter], {
      cwd: repoRoot,
      env: { ...process.env, STACKARR_DATABASE_FILE: databaseFile, STACKARR_DATABASE_URL: '' }
    });

    for (const key of [
      'ENABLE_CLEANUPARR',
      'CLEANUPARR_URL',
      'CLEANUPARR_IMAGE',
      'CLEANUPARR_BIND_IP',
      'CLEANUPARR_PORT',
      'CLEANUPARR_AUTO_CONFIGURE',
      'CLEANUPARR_MALWARE_CRON'
    ]) {
      assert.match(stdout, new RegExp(`^export ${key}=`, 'm'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every managed runtime setting is included in the runtime exporter', async () => {
  const defaultsSource = await readFile(path.join(repoRoot, 'packages/core/src/env.ts'), 'utf8');
  const exporterSource = await readFile(path.join(repoRoot, 'stackarr/scripts/runtime-config-export.cjs'), 'utf8');
  const defaultsStart = defaultsSource.indexOf('export const managedEnvDefaults');
  const defaultsEnd = defaultsSource.indexOf('\n};', defaultsStart);
  assert.ok(defaultsStart >= 0 && defaultsEnd > defaultsStart);

  const managedKeys = [...defaultsSource.slice(defaultsStart, defaultsEnd).matchAll(/^  ([A-Z][A-Z0-9_]*):/gm)].map(
    ([, key]) => key
  );
  const exportedKeys = new Set([...exporterSource.matchAll(/^  '([A-Z][A-Z0-9_]*)',?$/gm)].map(([, key]) => key));

  assert.deepEqual(
    managedKeys.filter((key) => !exportedKeys.has(key)),
    [],
    'Managed settings missing from runtime-config-export.cjs can silently disappear from Compose and backups'
  );
});

test('every sensitive Compose variable has a managed runtime source', async () => {
  const defaultsSource = await readFile(path.join(repoRoot, 'packages/core/src/env.ts'), 'utf8');
  const composeSource = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  const defaultsStart = defaultsSource.indexOf('export const managedEnvDefaults');
  const defaultsEnd = defaultsSource.indexOf('\n};', defaultsStart);
  assert.ok(defaultsStart >= 0 && defaultsEnd > defaultsStart);

  const managedKeys = new Set(
    [...defaultsSource.slice(defaultsStart, defaultsEnd).matchAll(/^  ([A-Z][A-Z0-9_]*):/gm)].map(([, key]) => key)
  );
  const composeKeys = [...composeSource.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map(([, key]) => key);
  const sensitiveKeys = [...new Set(composeKeys)].filter(
    (key) => /(PASSWORD|TOKEN|API_KEY|SECRET|CLAIM_CODE)/.test(key) || key.endsWith('_DATABASE_URL')
  );

  assert.deepEqual(
    sensitiveKeys.filter((key) => !managedKeys.has(key)),
    [],
    'Sensitive Compose settings must be represented in the managed runtime config and portable backup snapshot'
  );
});
