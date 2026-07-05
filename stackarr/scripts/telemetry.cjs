#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const { readSetting, writeRawSetting } = require('./stackarr-db.cjs');

const appVersion = '0.3.0-alpha.1';
const settingKey = 'stackarr.settings';
const command = process.argv[2] || 'status';
const args = process.argv.slice(3);

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

async function main() {
  switch (command) {
    case 'status':
      printJson(status());
      return;
    case 'preview':
      printJson({ payload: payload({ persistInstallId: false }) });
      return;
    case 'enable':
      enableTelemetry();
      return;
    case 'disable':
      updateSettings({ telemetry: { enabled: false } });
      printJson(status());
      return;
    case 'send':
      await sendTelemetry();
      return;
    default:
      usage();
  }
}

function usage() {
  process.stderr.write(`Usage:
  stackarr telemetry status
  stackarr telemetry preview
  stackarr telemetry enable --endpoint <https-url> [--channel stable] --yes
  stackarr telemetry disable
  stackarr telemetry send [--yes] [--force]
`);
  process.exit(2);
}

function enableTelemetry() {
  if (!telemetryFeatureEnabled()) {
    throw new Error('Telemetry is feature-gated in this build.');
  }

  const endpoint = valueAfter('--endpoint');
  const channel = valueAfter('--channel') || settings().telemetry.channel || 'stable';
  if (!endpoint) throw new Error('--endpoint is required');
  validateEndpoint(endpoint);
  if (!hasFlag('--yes')) {
    throw new Error('Pass --yes after reviewing `stackarr telemetry preview` to enable telemetry.');
  }

  const current = settings();
  updateSettings({
    telemetry: {
      enabled: true,
      endpoint,
      channel,
      installId: current.telemetry.installId || randomUUID()
    }
  });
  printJson(status());
}

async function sendTelemetry() {
  if (!telemetryFeatureEnabled()) {
    throw new Error('Telemetry is feature-gated in this build.');
  }

  const current = settings();
  const dryRun = !hasFlag('--yes');
  const event = payload({ persistInstallId: !dryRun });
  if (dryRun) {
    printJson({
      accepted: false,
      endpoint: current.telemetry.endpoint,
      payload: event,
      nextStep: 'Pass --yes to send after reviewing the payload.'
    });
    return;
  }

  if (!current.telemetry.enabled && !hasFlag('--force')) {
    throw new Error('Telemetry is disabled.');
  }

  if (!current.telemetry.endpoint) {
    throw new Error('Telemetry endpoint is not configured.');
  }

  validateEndpoint(current.telemetry.endpoint);
  const response = await fetch(current.telemetry.endpoint, {
    method: 'POST',
    headers: telemetryHeaders(),
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    throw new Error(`Telemetry endpoint returned HTTP ${response.status}`);
  }

  const sentAt = new Date().toISOString();
  updateSettings({ telemetry: { lastSentAt: sentAt } });
  printJson({ accepted: true, completed: true, status: response.status, sentAt });
}

function status() {
  const telemetry = settings().telemetry;
  return {
    featureEnabled: telemetryFeatureEnabled(),
    enabled: telemetry.enabled,
    endpoint: telemetry.endpoint,
    endpointConfigured: Boolean(telemetry.endpoint),
    channel: telemetry.channel,
    installId: telemetry.installId ? 'configured' : 'not-generated',
    lastSentAt: telemetry.lastSentAt
  };
}

function telemetryFeatureEnabled() {
  return envFlag(runtimeConfig().STACKARR_TELEMETRY_FEATURE_ENABLED, false);
}

function payload({ persistInstallId }) {
  const current = settings();
  const config = runtimeConfig();
  const installId =
    current.telemetry.installId || (persistInstallId ? persistInstallIdSetting(current) : 'not-generated');
  const enabledServices = serviceNames(config).sort();

  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    eventName: 'stackarr.heartbeat',
    generatedAt: new Date().toISOString(),
    install: {
      id: installId,
      channel: current.telemetry.channel || 'stable',
      appVersion,
      osFamily: osFamily(),
      arch: os.arch()
    },
    setup: {
      onboardingComplete: current.setup.onboardingComplete,
      installMode: current.setup.installMode,
      databaseMode: config.STACKARR_DATABASE_MODE === 'postgres' ? 'postgres' : 'app-default'
    },
    services: {
      enabled: enabledServices,
      dockerManaged: enabledServices.filter((name) => !['plex-native', 'jellyfin-native'].includes(name)),
      nativeManaged: enabledServices.filter((name) => ['plex-native', 'jellyfin-native'].includes(name)),
      mediaServers: {
        plex: mediaServerMode(config.PLEX_INSTALL_MODE),
        jellyfin: mediaServerMode(config.JELLYFIN_INSTALL_MODE)
      }
    },
    backups: {
      enabled: envFlag(config.ENABLE_BACKUP, true),
      schedule: normalizeBackupSchedule(config.BACKUP_SCHEDULE),
      retentionBucket: retentionBucket(config.BACKUP_RETENTION_COUNT),
      plexBackupMode: plexBackupMode(config.PLEX_BACKUP_MODE)
    },
    counts: {
      enabledServices: enabledServices.length,
      configuredServices: enabledServices.length,
      disabledServices: 0
    }
  };
}

function settings() {
  const stored = readJsonSetting(settingKey);
  return mergeSettings(defaultSettings(), stored);
}

function updateSettings(patch) {
  writeRawSetting(settingKey, JSON.stringify(mergeSettings(settings(), patch)));
}

function runtimeConfig() {
  return readJsonSetting('stackarr.runtimeConfig');
}

function telemetryHeaders() {
  const config = runtimeConfig();
  const headers = {
    'Content-Type': 'application/json',
    'X-Stackarr-Telemetry-Schema': '1'
  };

  if (config.STACKARR_TELEMETRY_INGEST_KEY) {
    headers.Authorization = `Bearer ${config.STACKARR_TELEMETRY_INGEST_KEY}`;
  }

  return headers;
}

function readJsonSetting(key) {
  const raw = readSetting(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function mergeSettings(base, patch) {
  return {
    ...base,
    ...patch,
    setup: { ...base.setup, ...(patch.setup || {}) },
    telemetry: { ...base.telemetry, ...(patch.telemetry || {}) }
  };
}

function defaultSettings() {
  return {
    setup: { onboardingComplete: false, installMode: 'unknown' },
    telemetry: { enabled: false, endpoint: '', installId: '', channel: 'stable', lastSentAt: '' }
  };
}

function persistInstallIdSetting(current) {
  const installId = randomUUID();
  updateSettings({ telemetry: { ...current.telemetry, installId } });
  return installId;
}

function serviceNames(config) {
  const names = ['stackarr', 'database', 'prowlarr'];
  if (envFlag(config.ENABLE_MOVIES, true)) names.push('radarr');
  if (envFlag(config.ENABLE_TV_SHOWS, true)) names.push('sonarr');
  if (envFlag(config.ENABLE_4K_SERVARR, false)) names.push('radarr4k', 'sonarr4k');
  if (envFlag(config.ENABLE_BAZARR, true)) names.push('bazarr');
  if (envFlag(config.ENABLE_LIDARR, true)) names.push('lidarr');
  if (envFlag(config.ENABLE_BOOKORBIT, false)) names.push('bookorbit');
  if (envFlag(config.ENABLE_ROMM, false)) names.push('romm');
  if (envFlag(config.ENABLE_TINYMEDIAMANAGER, true)) names.push('tinymediamanager');
  if (envFlag(config.ENABLE_RECYCLARR, true)) names.push('recyclarr');
  if (envFlag(config.ENABLE_FLARESOLVERR, true)) names.push('flaresolverr');
  if (envFlag(config.ENABLE_TIDARR, true)) names.push('tidarr');
  if (envFlag(config.ENABLE_SEERR, false)) names.push('seerr');
  if (envFlag(config.ENABLE_PULSARR, true)) names.push('pulsarr');
  if (envFlag(config.ENABLE_MAINTAINERR, false)) names.push('maintainerr');
  if (envFlag(config.ENABLE_TRACEARR, false)) names.push('tracearr');
  if (config.PLEX_INSTALL_MODE === 'docker') names.push('plex');
  if (config.PLEX_INSTALL_MODE === 'native') names.push('plex-native');
  if (config.JELLYFIN_INSTALL_MODE === 'docker') names.push('jellyfin');
  if (config.JELLYFIN_INSTALL_MODE === 'native') names.push('jellyfin-native');
  return [...new Set(names)];
}

function validateEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Telemetry endpoint must be a valid URL.');
  }

  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return;
  throw new Error('Telemetry endpoint must use HTTPS, except for localhost development.');
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}

function hasFlag(flag) {
  return args.includes(flag);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function osFamily() {
  switch (os.platform()) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'other';
  }
}

function mediaServerMode(value) {
  return value === 'docker' || value === 'native' ? value : 'disabled';
}

function normalizeBackupSchedule(value) {
  const schedule = String(value || '').toLowerCase();
  return ['daily', 'weekly', 'monthly', 'disabled'].includes(schedule) ? schedule : 'custom';
}

function retentionBucket(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 'unknown';
  if (count <= 4) return '1-4';
  if (count <= 12) return '5-12';
  if (count <= 52) return '13-52';
  return '53+';
}

function plexBackupMode(value) {
  return value === 'full' || value === 'lite' ? value : 'custom';
}

function envFlag(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}
