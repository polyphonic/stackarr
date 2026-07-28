import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { databaseExists } from '../database';
import { readEnv, writeEnvConfig } from '../env';
import { composePath, stackarrBin } from '../paths';
import { getServices } from '../services';
import { readSettings, type StackarrSettings, writeSettings } from '../settings';
import { readTasks } from '../tasks';
import { stackarrChannel, stackarrVersion } from '../version';

const telemetrySchemaVersion = 2;
const stackarrAppVersion = stackarrVersion;
const defaultSendTimeoutMs = 10_000;

export type TelemetryUpdateInput = {
  enabled?: boolean;
  endpoint?: string;
  channel?: string;
  confirmTelemetry?: boolean;
};

export type TelemetrySendInput = {
  dryRun?: boolean;
  force?: boolean;
};

export type TelemetryPayload = {
  schemaVersion: number;
  eventId: string;
  eventName: 'stackarr.heartbeat';
  generatedAt: string;
  install: {
    id: string;
    channel: string;
    appVersion: string;
    osFamily: 'macos' | 'linux' | 'windows' | 'other';
    arch: string;
  };
  setup: {
    onboardingComplete: boolean;
    installMode: StackarrSettings['setup']['installMode'];
    databaseMode: 'postgres' | 'app-default';
  };
  services: {
    enabled: string[];
    dockerManaged: string[];
    nativeManaged: string[];
    mediaServers: {
      plex: 'disabled' | 'native' | 'docker';
      jellyfin: 'disabled' | 'native' | 'docker';
    };
  };
  backups: {
    enabled: boolean;
    schedule: string;
    retentionBucket: string;
    plexBackupMode: 'lite' | 'full' | 'custom';
  };
  counts: {
    enabledServices: number;
    configuredServices: number;
    disabledServices: number;
  };
  health: {
    issueCodes: string[];
    recentTaskFailures: string;
    recentBlockedTasks: string;
  };
};

export function getTelemetryStatusAction() {
  const settings = readSettings();
  const featureEnabled = telemetryFeatureEnabled();
  const endpoint = normalizeTelemetryEndpoint(settings.telemetry.endpoint);

  return {
    featureEnabled,
    enabled: settings.telemetry.enabled,
    endpoint,
    endpointConfigured: Boolean(endpoint),
    channel: settings.telemetry.channel,
    installId: settings.telemetry.installId ? 'configured' : 'not-generated',
    lastSentAt: settings.telemetry.lastSentAt,
    payloadPreview: buildTelemetryPayload({ persistInstallId: false })
  };
}

export function updateTelemetryConfigAction(input: TelemetryUpdateInput) {
  const current = readSettings();
  const featureEnabled = telemetryFeatureEnabled();
  const nextEndpoint =
    input.endpoint !== undefined ? normalizeTelemetryEndpoint(input.endpoint) : current.telemetry.endpoint;
  const nextEnabled = input.enabled ?? current.telemetry.enabled;

  if (nextEnabled && !featureEnabled) {
    return {
      accepted: false,
      error: 'Telemetry is feature-gated in this build.'
    };
  }

  if (nextEndpoint) {
    const endpointError = validateTelemetryEndpoint(nextEndpoint);
    if (endpointError) {
      return { accepted: false, error: endpointError };
    }
  }

  if (nextEnabled && !nextEndpoint) {
    return {
      accepted: false,
      error: 'Telemetry endpoint is required before telemetry can be enabled.'
    };
  }

  if (nextEnabled && !input.confirmTelemetry) {
    return {
      accepted: false,
      confirmationRequired: true,
      preview: buildTelemetryPayload({ persistInstallId: false }),
      nextStep: 'Call again with confirmTelemetry: true after reviewing the payload preview.'
    };
  }

  const installId = nextEnabled ? current.telemetry.installId || randomUUID() : current.telemetry.installId;
  const settings = writeSettings({
    telemetry: {
      enabled: nextEnabled,
      endpoint: nextEndpoint,
      channel: normalizeTelemetryChannel(input.channel ?? current.telemetry.channel),
      installId
    }
  });

  return {
    accepted: true,
    telemetry: publicTelemetrySettings(settings)
  };
}

export function previewTelemetryPayloadAction() {
  return {
    accepted: false,
    payload: buildTelemetryPayload({ persistInstallId: false }),
    notes: [
      'This preview excludes host paths, hostnames, usernames, media titles, request names, API keys, and tokens.',
      'The install id is a random pseudonymous id used for active-install counts after telemetry is enabled.'
    ]
  };
}

export async function sendTelemetryAction(input: TelemetrySendInput = {}) {
  const dryRun = input.dryRun !== false;
  const settings = readSettings();
  const featureEnabled = telemetryFeatureEnabled();
  const endpoint = normalizeTelemetryEndpoint(settings.telemetry.endpoint);
  const payload = buildTelemetryPayload({ persistInstallId: !dryRun });

  if (!featureEnabled) {
    return {
      accepted: false,
      payload,
      error: 'Telemetry is feature-gated in this build.'
    };
  }

  if (dryRun) {
    return {
      accepted: false,
      endpoint,
      payload,
      nextStep:
        'Call stackarr_send_telemetry with dryRun: false after telemetry is enabled and the payload is reviewed.'
    };
  }

  if (!settings.telemetry.enabled && !input.force) {
    return {
      accepted: false,
      payload,
      error: 'Telemetry is disabled.'
    };
  }

  if (!endpoint) {
    return {
      accepted: false,
      payload,
      error: 'Telemetry endpoint is not configured.'
    };
  }

  const endpointError = validateTelemetryEndpoint(endpoint);
  if (endpointError) {
    return {
      accepted: false,
      payload,
      error: endpointError
    };
  }

  const env = readEnv();
  const adminIngestKey = env.STACKARR_TELEMETRY_INGEST_KEY?.trim() ?? '';
  let credential = adminIngestKey || env.STACKARR_TELEMETRY_CLIENT_TOKEN?.trim() || '';
  if (!credential) {
    credential = await registerTelemetryClient(endpoint, payload.install.id);
  }

  let response = await postTelemetry(endpoint, payload, credential);
  if (response.status === 401 && !adminIngestKey) {
    credential = await registerTelemetryClient(endpoint, payload.install.id);
    response = await postTelemetry(endpoint, payload, credential);
  }

  if (!response.ok) {
    throw new Error(`Telemetry endpoint returned HTTP ${response.status}`);
  }
  const sentAt = new Date().toISOString();
  writeSettings({ telemetry: { lastSentAt: sentAt } });

  return {
    accepted: true,
    completed: true,
    endpoint,
    status: response.status,
    sentAt
  };
}

export async function maybeSendTelemetryHeartbeatAction() {
  const settings = readSettings();

  if (!telemetryFeatureEnabled()) {
    return { accepted: false, skipped: true, reason: 'feature-gated' };
  }

  if (!settings.telemetry.enabled) {
    return { accepted: false, skipped: true, reason: 'telemetry-disabled' };
  }

  if (!settings.telemetry.endpoint) {
    return { accepted: false, skipped: true, reason: 'endpoint-not-configured' };
  }

  if (!shouldSendHeartbeat(settings.telemetry.lastSentAt)) {
    return { accepted: false, skipped: true, reason: 'recently-sent' };
  }

  try {
    return await sendTelemetryAction({ dryRun: false });
  } catch (error) {
    return {
      accepted: false,
      skipped: false,
      reason: 'send-failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function buildTelemetryPayload(options: { persistInstallId?: boolean } = {}): TelemetryPayload {
  const settings = readSettings();
  const env = readEnv();
  const installId =
    settings.telemetry.installId || (options.persistInstallId ? persistTelemetryInstallId() : 'not-generated');
  const services = getServices();
  const enabledServices = services
    .filter((service) => service.mode !== 'disabled')
    .map((service) => service.name)
    .sort();

  return {
    schemaVersion: telemetrySchemaVersion,
    eventId: randomUUID(),
    eventName: 'stackarr.heartbeat',
    generatedAt: new Date().toISOString(),
    install: {
      id: installId,
      channel: settings.telemetry.channel || stackarrChannel,
      appVersion: stackarrAppVersion,
      osFamily: osFamily(),
      arch: os.arch()
    },
    setup: {
      onboardingComplete: settings.setup.onboardingComplete,
      installMode: settings.setup.installMode,
      databaseMode: env.STACKARR_DATABASE_MODE === 'postgres' ? 'postgres' : 'app-default'
    },
    services: {
      enabled: enabledServices,
      dockerManaged: services
        .filter((service) => service.mode === 'docker')
        .map((service) => service.name)
        .sort(),
      nativeManaged: services
        .filter((service) => service.mode === 'native')
        .map((service) => service.name)
        .sort(),
      mediaServers: {
        plex: mediaServerMode(env.PLEX_INSTALL_MODE),
        jellyfin: mediaServerMode(env.JELLYFIN_INSTALL_MODE)
      }
    },
    backups: {
      enabled: envFlag(env.ENABLE_BACKUP, true),
      schedule: normalizeBackupSchedule(env.BACKUP_SCHEDULE),
      retentionBucket: retentionBucket(env.BACKUP_RETENTION_COUNT),
      plexBackupMode: plexBackupMode(env.PLEX_BACKUP_MODE)
    },
    counts: {
      enabledServices: enabledServices.length,
      configuredServices: services.filter((service) => service.status === 'configured').length,
      disabledServices: services.filter((service) => service.status === 'disabled').length
    },
    health: telemetryHealthSummary()
  };
}

function persistTelemetryInstallId() {
  const current = readSettings();
  if (current.telemetry.installId) {
    return current.telemetry.installId;
  }

  const installId = randomUUID();
  writeSettings({ telemetry: { installId } });
  return installId;
}

function publicTelemetrySettings(settings: StackarrSettings) {
  return {
    enabled: settings.telemetry.enabled,
    endpoint: settings.telemetry.endpoint,
    channel: settings.telemetry.channel,
    installId: settings.telemetry.installId ? 'configured' : 'not-generated',
    lastSentAt: settings.telemetry.lastSentAt
  };
}

async function postTelemetry(endpoint: string, payload: TelemetryPayload, credential: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultSendTimeoutMs);
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Stackarr-Telemetry-Schema': String(telemetrySchemaVersion)
  });

  headers.set('Authorization', `Bearer ${credential}`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function registerTelemetryClient(endpoint: string, installId: string) {
  const registrationEndpoint = telemetryRegistrationEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultSendTimeoutMs);

  try {
    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: telemetrySchemaVersion,
        installId,
        appVersion: stackarrAppVersion
      }),
      signal: controller.signal
    });
    const body = (await response.json().catch(() => ({}))) as { token?: unknown };

    if (!response.ok || typeof body.token !== 'string' || body.token.length < 32) {
      throw new Error(`Telemetry registration returned HTTP ${response.status}`);
    }

    writeEnvConfig({ STACKARR_TELEMETRY_CLIENT_TOKEN: body.token });
    return body.token;
  } finally {
    clearTimeout(timeout);
  }
}

function telemetryRegistrationEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.at(-1) === 'events') {
    segments[segments.length - 1] = 'register';
  } else {
    segments.push('register');
  }

  url.pathname = `/${segments.join('/')}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function telemetryHealthSummary(): TelemetryPayload['health'] {
  const issueCodes: string[] = [];
  if (!databaseExists()) issueCodes.push('config_missing');
  if (!fs.existsSync(composePath)) issueCodes.push('compose_missing');
  if (!fs.existsSync(stackarrBin)) issueCodes.push('cli_missing');

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentTasks = readTasks().filter((task) => {
    const timestamp = Date.parse(task.endedAt || task.startedAt || task.queuedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  const failed = recentTasks.filter((task) => task.status === 'failed' && !task.reviewedAt).length;
  const blocked = recentTasks.filter(
    (task) => task.status === 'blocked' && !task.reviewedAt && !isExpectedHostApprovalBlock(task)
  ).length;
  if (failed > 0) issueCodes.push('recent_task_failures');
  if (blocked > 0) issueCodes.push('recent_blocked_tasks');

  return {
    issueCodes,
    recentTaskFailures: countBucket(failed),
    recentBlockedTasks: countBucket(blocked)
  };
}

function isExpectedHostApprovalBlock(task: ReturnType<typeof readTasks>[number]) {
  return task.output?.startsWith('Host approval required.') === true;
}

function countBucket(count: number) {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 4) return '2-4';
  return '5+';
}

function normalizeTelemetryEndpoint(value: string | undefined) {
  return String(value ?? '').trim();
}

function normalizeTelemetryChannel(value: string | undefined) {
  const channel = String(value ?? '').trim();
  return channel || stackarrChannel;
}

function validateTelemetryEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'Telemetry endpoint must be a valid URL.';
  }

  if (url.protocol === 'https:') {
    return undefined;
  }

  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    return undefined;
  }

  return 'Telemetry endpoint must use HTTPS, except for localhost development.';
}

function osFamily(): TelemetryPayload['install']['osFamily'] {
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

function mediaServerMode(value: string | undefined): 'disabled' | 'native' | 'docker' {
  return value === 'docker' || value === 'native' ? value : 'disabled';
}

function normalizeBackupSchedule(value: string | undefined) {
  const schedule = String(value ?? '').toLowerCase();
  return ['daily', 'weekly', 'monthly', 'disabled'].includes(schedule) ? schedule : 'custom';
}

function retentionBucket(value: string | undefined) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 'unknown';
  if (count <= 4) return '1-4';
  if (count <= 12) return '5-12';
  if (count <= 52) return '13-52';
  return '53+';
}

function plexBackupMode(value: string | undefined): 'lite' | 'full' | 'custom' {
  return value === 'full' || value === 'lite' ? value : 'custom';
}

function envFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function telemetryFeatureEnabled() {
  return true;
}

function shouldSendHeartbeat(lastSentAt: string) {
  if (!lastSentAt) {
    return true;
  }

  const lastSentMs = Date.parse(lastSentAt);
  if (!Number.isFinite(lastSentMs)) {
    return true;
  }

  return Date.now() - lastSentMs >= 24 * 60 * 60 * 1000;
}
