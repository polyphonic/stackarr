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

test('host runtime reload reads current PostgreSQL settings through the Stackarr app', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-compose-env-postgres-reload-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const binDir = path.join(root, 'bin');
  const stateRoot = path.join(root, 'app/state');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'docker'),
      [
        '#!/bin/sh',
        'case " $* " in',
        '  *" exec -T app sh -lc "*)',
        '    printf "%s\\n" "export USERNAME=\u0027fresh-user\u0027" "export PASSWORD=\u0027fresh-password\u0027" "export TRANSMISSION_PASSWORD=\u0027fresh-password\u0027"',
        '    exit 0',
        '    ;;',
        'esac',
        'exit 1',
        ''
      ].join('\n')
    );
    await chmod(path.join(binDir, 'docker'), 0o755);
    await writeFile(
      composeEnvFile,
      [
        `APP_ROOT="${path.join(root, 'app')}"`,
        `CONFIG_ROOT="${path.join(root, 'app/config')}"`,
        `STATE_ROOT="${stateRoot}"`,
        `LOG_ROOT="${path.join(root, 'app/logs')}"`,
        'USERNAME="stale-user"',
        'PASSWORD="stale-password"',
        'TRANSMISSION_PASSWORD="stale-password"',
        'STACKARR_DATABASE_MODE="postgres"',
        'STACKARR_DATABASE_URL="postgres://stackarr:secret@database:5432/stackarr-main"',
        ''
      ].join('\n')
    );

    const { stdout } = await execFile(
      'bash',
      [
        '-c',
        'source "$1"; load_env; printf "%s\\n%s\\n%s\\n" "$USERNAME" "$PASSWORD" "$TRANSMISSION_PASSWORD"',
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
          STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db')
        }
      }
    );

    assert.equal(stdout, 'fresh-user\nfresh-password\nfresh-password\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy image-declared volume data is copied to the stable Compose volume before recreation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-volume-migration-test-'));
  const binDir = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'docker'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$STACKARR_DOCKER_LOG"',
        'case "$1 $2 $3 $4" in',
        '  "inspect --format "*)',
        '    case "$3" in',
        '      *Mounts*) printf "%s\\n" "volume|legacy-romm-volume" ;;',
        '      *State.Running*) printf "%s\\n" "true" ;;',
        '    esac',
        '    ;;',
        '  "volume inspect fixture_romm-root "*) exit 1 ;;',
        'esac',
        'exit 0',
        ''
      ].join('\n')
    );
    await chmod(path.join(binDir, 'docker'), 0o755);

    await execFile(
      'bash',
      ['-c', 'source "$1"; migrate_legacy_image_volume romm /romm romm-root', 'bash', commonScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          STACKARR_DOCKER_LOG: dockerLog,
          COMPOSE_PROJECT_NAME: 'fixture',
          STACKARR_IMAGE: 'polyphonic/stackarr:test'
        }
      }
    );

    const commands = await readFile(dockerLog, 'utf8');
    assert.match(commands, /volume create .*com\.docker\.compose\.project=fixture/);
    assert.match(commands, /com\.docker\.compose\.volume=romm-root fixture_romm-root/);
    assert.match(commands, /stop romm/);
    assert.match(commands, /legacy-romm-volume:\/source:ro -v fixture_romm-root:\/target/);
    assert.match(commands, /cp -a \/source\/\. \/target\//);
    assert.match(commands, /diff -qr \/source \/target/);
    assert.doesNotMatch(commands, /volume rm legacy-romm-volume/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed legacy volume copies retain the source and roll back the empty target', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-volume-migration-rollback-test-'));
  const binDir = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'docker'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$STACKARR_DOCKER_LOG"',
        'case "$1 $2 $3 $4" in',
        '  "inspect --format "*)',
        '    case "$3" in',
        '      *Mounts*) printf "%s\\n" "volume|legacy-romm-volume" ;;',
        '      *State.Running*) printf "%s\\n" "true" ;;',
        '    esac',
        '    ;;',
        '  "volume inspect fixture_romm-root "*) exit 1 ;;',
        'esac',
        'case "$*" in',
        '  *"cp -a /source/. /target/"*) exit 1 ;;',
        'esac',
        'exit 0',
        ''
      ].join('\n')
    );
    await chmod(path.join(binDir, 'docker'), 0o755);

    await assert.rejects(
      execFile('bash', ['-c', 'source "$1"; migrate_legacy_image_volume romm /romm romm-root', 'bash', commonScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          STACKARR_DOCKER_LOG: dockerLog,
          COMPOSE_PROJECT_NAME: 'fixture',
          STACKARR_IMAGE: 'polyphonic/stackarr:test'
        }
      })
    );

    const commands = await readFile(dockerLog, 'utf8');
    assert.match(commands, /stop romm/);
    assert.match(commands, /volume rm fixture_romm-root/);
    assert.match(commands, /start romm/);
    assert.doesNotMatch(commands, /volume rm legacy-romm-volume/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a verified legacy volume copy can resume Compose after an interrupted recreation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-volume-migration-resume-test-'));
  const binDir = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'docker'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$STACKARR_DOCKER_LOG"',
        'case "$1 $2 $3 $4" in',
        '  "inspect --format "*) printf "%s\\n" "volume|legacy-romm-volume" ;;',
        'esac',
        'case "$*" in',
        '  *"test -z"*) exit 1 ;;',
        '  *"diff -qr /source /target"*) exit 0 ;;',
        'esac',
        'exit 0',
        ''
      ].join('\n')
    );
    await chmod(path.join(binDir, 'docker'), 0o755);

    await execFile(
      'bash',
      ['-c', 'source "$1"; migrate_legacy_image_volume romm /romm romm-root', 'bash', commonScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          STACKARR_DOCKER_LOG: dockerLog,
          COMPOSE_PROJECT_NAME: 'fixture',
          STACKARR_IMAGE: 'polyphonic/stackarr:test'
        }
      }
    );

    const commands = await readFile(dockerLog, 'utf8');
    assert.match(commands, /diff -qr \/source \/target/);
    assert.doesNotMatch(commands, /stop romm|cp -a \/source|volume rm/);
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

    const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
    const appService = compose.match(/\n  app:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n)/)?.[1] ?? '';
    assert.match(appService, /:\/stackarr-romm-library\/Steam:ro"/);
    assert.match(appService, /:\/stackarr-romm-library\/SteamWindows:ro"/);
    assert.match(appService, /:\/stackarr-romm-library\/SteamLinux:ro"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Youtarr runtime env stays private and generates dedicated credentials and paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-youtarr-env-test-'));
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
        ENABLE_YOUTARR: 'true',
        USERNAME: 'stackarr-user',
        PASSWORD: 'PortableYoutarrPassword',
        PLEX_INSTALL_MODE: 'docker',
        STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db')
      }
    });

    const content = await readFile(composeEnvFile, 'utf8');
    assert.match(content, /^ENABLE_YOUTARR="true"$/m);
    assert.match(content, /^YOUTARR_BIND_IP="127\.0\.0\.1"$/m);
    assert.match(content, new RegExp(`^YOUTARR_OUTPUT_ROOT="${path.join(appRoot, 'media/Videos/YouTube')}"$`, 'm'));
    assert.match(content, new RegExp(`^YOUTARR_CONFIG_ROOT="${path.join(appRoot, 'config/youtarr/config')}"$`, 'm'));
    assert.match(content, /^YOUTARR_DB_PASSWORD="[A-Za-z0-9]{24}"$/m);
    assert.match(content, /^YOUTARR_DB_ROOT_PASSWORD="[A-Za-z0-9]{24}"$/m);
    assert.match(content, /^YOUTARR_LOGIN_ENABLED="true"$/m);
    assert.match(content, /^YOUTARR_ADMIN_USERNAME="stackarr-user"$/m);
    assert.match(content, /^YOUTARR_ADMIN_PASSWORD="PortableYoutarrPassword"$/m);
    assert.match(content, /^YOUTARR_PLEX_URL="http:\/\/plex:32400"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Youtarr uses the upstream standard data layout so every persistent mount is active', async () => {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  const service = compose.match(/\n  youtarr:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n)/)?.[1] ?? '';

  assert.ok(service, 'Youtarr Compose service is present');
  assert.match(service, /dialmaster\/youtarr:latest/);
  assert.doesNotMatch(service, /^      DATA_PATH:/m);
  assert.match(service, /:\/usr\/src\/app\/data"/);
  assert.match(service, /:\/app\/server\/images"/);
  assert.match(service, /:\/app\/config"/);
  assert.match(service, /:\/app\/jobs"/);
  assert.match(service, /\/api\/health/);
});

test('Application images stay current while stateful database engines remain version-pinned', async () => {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');

  assert.match(compose, /TINYMEDIAMANAGER_IMAGE:-tinymediamanager\/tinymediamanager:latest/);
  assert.match(compose, /YOUTARR_IMAGE:-dialmaster\/youtarr:latest/);
  assert.match(compose, /YOUTARR_DB_IMAGE:-mariadb:\d+\.\d+/);
  assert.doesNotMatch(compose, /YOUTARR_DB_IMAGE:-mariadb:latest/);
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
