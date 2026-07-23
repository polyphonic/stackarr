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
