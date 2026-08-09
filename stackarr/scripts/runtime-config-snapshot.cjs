#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { readSetting, writeSettings } = require('./stackarr-db.cjs');

const VERSION = 1;
const CONTEXT_ONLY_KEYS = new Set([
  'COMPOSE_PROJECT_NAME',
  'STACKARR_CHANNEL',
  'STACKARR_CLI_BIN',
  'STACKARR_COMPOSE_ENV_FILE',
  'STACKARR_COMPOSE_FILE',
  'STACKARR_COMPOSE_PROJECT_DIR',
  'STACKARR_CONTAINER_NAME',
  'STACKARR_DATABASE_DIR',
  'STACKARR_DATABASE_FILE',
  'STACKARR_PLEX_HOST',
  'STACKARR_REPO_ROOT',
  'STACKARR_REVISION',
  'STACKARR_RUN_SOURCE',
  'STACKARR_RUNTIME',
  'STACKARR_SCHEDULER_ENABLED',
  'STACKARR_TASK_ID',
  'STACKARR_UPDATE_TASK_ID',
  'STACKARR_VERSION'
]);

function fail(message) {
  process.stderr.write(`Runtime config snapshot failed: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { command: argv[2] || 'create' };

  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!['--output', '--input', '--compose-env', '--audit-output'].includes(key) || !value) {
      fail(`unknown or incomplete argument: ${key}`);
    }

    args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }

  return args;
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};

  const values = {};
  for (const sourceLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;

    try {
      if (raw.startsWith('"') && raw.endsWith('"')) {
        values[key] = JSON.parse(raw).replace(/\$\$/g, '$');
      } else if (raw.startsWith("'") && raw.endsWith("'")) {
        values[key] = raw.slice(1, -1);
      } else {
        values[key] = raw;
      }
    } catch {
      fail(`could not parse ${key} from the Compose environment file`);
    }
  }

  return values;
}

function isManagedRuntimeKey(key) {
  return (
    !CONTEXT_ONLY_KEYS.has(key) &&
    /^(?:APP_ROOT|CONFIG_ROOT|STATE_ROOT|LOG_ROOT|MEDIA_ROOT|MUSIC_ROOT|DOWNLOADS_ROOT|BOOKS_ROOT|GAMES_ROOT|BACKUP_ROOT|BACKUP_STAGING_ROOT|TIMEZONE|PUID|PGID|USERNAME|PASSWORD|USER_EMAIL|PREFERRED_TORRENT_CLIENT|STACKARR_.*|ENABLE_.*|PLEX_.*|JELLYFIN_.*|BOOKORBIT_.*|IMMICH_.*|ROMM_.*|QUESTARR_.*|YOUTARR_.*|DATABASE_.*|SEERR_.*|PULSARR_.*|MAINTAINERR_.*|CLEANUPARR_.*|AGREGARR_.*|TRACEARR_.*|BAZARR_.*|PROWLARR_.*|RADARR.*|SONARR.*|LIDARR_.*|TIDARR_.*|TINYMEDIAMANAGER_.*|TRANSMISSION_.*|QBITTORRENT_.*|RECYCLARR_.*|FLARESOLVERR_.*|BACKUP_.*|UPDATE_.*|DOWNLOAD_.*|CLOUDFLARE_.*|CLOUDFLARED_.*)$/.test(
      key
    )
  );
}

function isCredentialKey(key) {
  if (key.endsWith('_TOKEN_FILE')) return false;
  return (
    /(PASSWORD|TOKEN|SECRET|CLAIM_CODE|_KEY)$/.test(key) ||
    key === 'ROMM_IGDB_CLIENT_ID' ||
    key === 'QUESTARR_IGDB_CLIENT_ID' ||
    key === 'ROMM_SCREENSCRAPER_USER' ||
    key === 'STACKARR_DATABASE_URL' ||
    key === 'STACKARR_LOG_DATABASE_URL' ||
    key.endsWith('_DATABASE_URL') ||
    key.endsWith('_DB_URL')
  );
}

function knownCredentialKeys(config, compose) {
  const exporterPath = path.join(__dirname, 'runtime-config-export.cjs');
  const exportedKeys = fs.existsSync(exporterPath)
    ? [...fs.readFileSync(exporterPath, 'utf8').matchAll(/^  '([A-Z][A-Z0-9_]*)',?$/gm)].map(([, key]) => key)
    : [];

  return [...new Set([...exportedKeys, ...Object.keys(config), ...Object.keys(compose)])]
    .filter(isCredentialKey)
    .sort();
}

function readRuntimeConfig() {
  const raw = readSetting('stackarr.runtimeConfig');
  if (!raw) return null;

  try {
    const config = JSON.parse(raw);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      fail('stackarr.runtimeConfig is not an object');
    }
    return config;
  } catch {
    fail('stackarr.runtimeConfig is not valid JSON');
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, filePath);
}

function createSnapshot(args) {
  if (!args.output) fail('--output is required');

  const compose = parseEnvFile(args.composeEnv);
  let config = readRuntimeConfig();
  const patch = {};
  let source = 'stackarr.runtimeConfig';

  if (!config) {
    config = Object.fromEntries(Object.entries(compose).filter(([key]) => isManagedRuntimeKey(key)));
    if (Object.keys(config).length === 0) {
      fail('stackarr.runtimeConfig is unavailable and no managed Compose environment fallback exists');
    }
    source = 'compose-fallback';
  } else {
    config = Object.fromEntries(Object.entries(config).filter(([key]) => isManagedRuntimeKey(key)));
  }

  if (source === 'stackarr.runtimeConfig') {
    for (const [key, value] of Object.entries(compose)) {
      if (!isManagedRuntimeKey(key) || value === '' || String(config[key] ?? '') !== '') continue;
      patch[key] = String(value);
    }

    if (Object.keys(patch).length > 0) {
      writeSettings(patch);
      config = { ...config, ...patch };
    }
  }

  atomicWriteJson(args.output, {
    version: VERSION,
    createdAt: new Date().toISOString(),
    runtimeConfig: config
  });

  if (args.auditOutput) {
    const credentials = knownCredentialKeys(config, compose).map((key) => ({
      key,
      configured: Boolean(String(config[key] ?? ''))
    }));
    atomicWriteJson(args.auditOutput, {
      version: VERSION,
      createdAt: new Date().toISOString(),
      source,
      reconciledFromCompose: Object.keys(patch).sort(),
      credentials
    });
  }

  process.stdout.write(
    `Runtime config snapshot captured ${Object.keys(config).length} managed values from ${source}; reconciled ${Object.keys(patch).length} missing value(s) from Compose.\n`
  );
}

function restoreSnapshot(args) {
  if (!args.input) fail('--input is required');

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  } catch {
    fail('snapshot is not valid JSON');
  }

  if (snapshot?.version !== VERSION || !snapshot.runtimeConfig || typeof snapshot.runtimeConfig !== 'object') {
    fail('snapshot format is unsupported');
  }

  const patch = Object.fromEntries(
    Object.entries(snapshot.runtimeConfig).filter(
      ([key, value]) => isManagedRuntimeKey(key) && typeof value === 'string'
    )
  );
  writeSettings(patch);
  process.stdout.write(`Restored ${Object.keys(patch).length} managed runtime values from the portable snapshot.\n`);
}

const args = parseArgs(process.argv);
if (args.command === 'create') createSnapshot(args);
else if (args.command === 'restore') restoreSnapshot(args);
else fail(`unknown command: ${args.command}`);
