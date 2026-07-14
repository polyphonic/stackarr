import type { TelemetryPayload } from '@stackarr/db';
import type { NextRequest } from 'next/server';
import { getTelemetryCollectorConfig } from '../../../../env/server';
import { safeEqual, verifyTelemetryClientToken } from '../auth';
import { checkTelemetryRateLimit } from '../rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const config = telemetryCollectorConfig();
  if (!config.enabled) {
    const error = 'error' in config ? config.error : undefined;
    return json({ accepted: false, error: error ?? 'Telemetry collector is disabled.' }, { status: error ? 503 : 404 });
  }

  const rateLimit = await telemetryRateLimit(request, config, 'ingest');
  if (!rateLimit.ok) return rateLimit.response;
  if (!rateLimit.result.allowed) {
    return json(
      { accepted: false, error: 'Too many telemetry events. Try again later.' },
      { status: 429, headers: rateLimit.result.headers }
    );
  }

  const raw = await readBoundedBody(request, config.maxPayloadBytes);
  if (!raw.ok) {
    return json({ accepted: false, error: raw.error }, { status: raw.status });
  }

  const payload = parseJsonObject(raw.body);
  const validationError = validateTelemetryPayload(payload, config.maxPayloadBytes);
  if (validationError) {
    return json({ accepted: false, error: validationError }, { status: 400 });
  }

  const installId = (payload as TelemetryPayload).install.id;
  if (!authenticate(request, config.ingestKey, installId)) {
    return json({ accepted: false, error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { recordTelemetryEvent } = await import('@stackarr/db');
    const result = await recordTelemetryEvent({ payload: payload as TelemetryPayload });
    return json(result, { status: 202, headers: rateLimit.result.headers });
  } catch (error) {
    return json(
      {
        accepted: false,
        error: error instanceof Error ? error.message : 'Telemetry ingest failed.'
      },
      { status: 503 }
    );
  }
}

async function telemetryRateLimit(
  request: NextRequest,
  config: ReturnType<typeof getTelemetryCollectorConfig> & { enabled: true },
  policy: 'ingest'
) {
  try {
    return { ok: true as const, result: await checkTelemetryRateLimit(request, config, policy) };
  } catch {
    return {
      ok: false as const,
      response: json({ accepted: false, error: 'Telemetry rate limiting is unavailable.' }, { status: 503 })
    };
  }
}

function authenticate(request: NextRequest, expected: string, installId: string) {
  const actual =
    bearerToken(request.headers.get('authorization')) || request.headers.get('x-stackarr-telemetry-key') || '';

  return safeEqual(actual, expected) || verifyTelemetryClientToken(actual, expected, installId);
}

function bearerToken(value: string | null) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function validateTelemetryPayload(value: unknown, maxPayloadBytes: number): string | undefined {
  if (!value || typeof value !== 'object') {
    return 'Telemetry payload must be a JSON object.';
  }

  const payload = value as Record<string, unknown>;
  const install = objectValue(payload.install);
  const setup = objectValue(payload.setup);
  const services = objectValue(payload.services);
  const backups = objectValue(payload.backups);
  const counts = objectValue(payload.counts);
  const health = objectValue(payload.health);

  if (payload.schemaVersion !== 1 && payload.schemaVersion !== 2) return 'Unsupported telemetry schemaVersion.';
  if (payload.eventName !== 'stackarr.heartbeat') return 'Unsupported telemetry eventName.';
  if (
    !hasOnlyKeys(payload, [
      'schemaVersion',
      'eventId',
      'eventName',
      'generatedAt',
      'install',
      'setup',
      'services',
      'backups',
      'counts',
      'health'
    ])
  )
    return 'Telemetry payload contains unsupported fields.';
  if (!uuidValue(payload.eventId)) return 'Telemetry eventId must be a UUID.';
  if (!stringValue(payload.generatedAt, 64)) return 'Telemetry generatedAt is required.';
  if (!validGeneratedAt(payload.generatedAt)) return 'Telemetry generatedAt is invalid or outside the accepted window.';
  if (!install || !uuidValue(install.id)) return 'Telemetry install.id must be a UUID.';
  if (!hasOnlyKeys(install, ['id', 'channel', 'appVersion', 'osFamily', 'arch']))
    return 'Telemetry install contains unsupported fields.';
  if (!install || !stringValue(install.channel, 64)) return 'Telemetry install.channel is required.';
  if (!install || !stringValue(install.appVersion, 64)) return 'Telemetry install.appVersion is required.';
  if (!install || !stringValue(install.osFamily, 32)) return 'Telemetry install.osFamily is required.';
  if (!install || !stringValue(install.arch, 32)) return 'Telemetry install.arch is required.';
  if (!setup || !hasOnlyKeys(setup, ['onboardingComplete', 'installMode', 'databaseMode']))
    return 'Telemetry setup contains unsupported fields.';
  if (typeof setup.onboardingComplete !== 'boolean') return 'Telemetry setup.onboardingComplete must be a boolean.';
  if (!stringValue(setup.installMode, 32)) return 'Telemetry setup.installMode is required.';
  if (!setup || !stringValue(setup.databaseMode, 32)) return 'Telemetry setup.databaseMode is required.';
  if (!services || !hasOnlyKeys(services, ['enabled', 'dockerManaged', 'nativeManaged', 'mediaServers']))
    return 'Telemetry services contains unsupported fields.';
  if (!serviceList(services.enabled) || !serviceList(services.dockerManaged) || !serviceList(services.nativeManaged))
    return 'Telemetry service lists are invalid.';
  const mediaServers = objectValue(services.mediaServers);
  if (!mediaServers || !hasOnlyKeys(mediaServers, ['plex', 'jellyfin']))
    return 'Telemetry services.mediaServers is invalid.';
  if (!backups) return 'Telemetry backups object is required.';
  if (!hasOnlyKeys(backups, ['enabled', 'schedule', 'retentionBucket', 'plexBackupMode']))
    return 'Telemetry backups contains unsupported fields.';
  if (!counts) return 'Telemetry counts object is required.';
  if (!hasOnlyKeys(counts, ['enabledServices', 'configuredServices', 'disabledServices']))
    return 'Telemetry counts contains unsupported fields.';
  if (!Object.values(counts).every((value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 128))
    return 'Telemetry counts are invalid.';
  if (payload.schemaVersion === 2 && !health) return 'Telemetry health object is required.';
  if (
    health &&
    (!hasOnlyKeys(health, ['issueCodes', 'recentTaskFailures', 'recentBlockedTasks']) ||
      !issueCodeList(health.issueCodes) ||
      !countBucket(health.recentTaskFailures) ||
      !countBucket(health.recentBlockedTasks))
  )
    return 'Telemetry health object is invalid.';

  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > maxPayloadBytes) return 'Telemetry payload is too large.';
  if (containsForbiddenTelemetryText(serialized)) return 'Telemetry payload contains forbidden sensitive fields.';

  return undefined;
}

async function readBoundedBody(request: NextRequest, maxBytes: number) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false as const, status: 413, error: 'Telemetry payload is too large.' };
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    return { ok: false as const, status: 413, error: 'Telemetry payload is too large.' };
  }

  return { ok: true as const, body };
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function uuidValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function validGeneratedAt(value: unknown) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= 7 * 24 * 60 * 60 * 1000;
}

function serviceList(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((item) => typeof item === 'string' && /^[a-z0-9-]{1,48}$/.test(item))
  );
}

function issueCodeList(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((item) => typeof item === 'string' && /^[a-z0-9_]{1,48}$/.test(item))
  );
}

function countBucket(value: unknown) {
  return value === '0' || value === '1' || value === '2-4' || value === '5+';
}

function telemetryCollectorConfig() {
  try {
    return getTelemetryCollectorConfig();
  } catch (error) {
    return {
      enabled: false as const,
      error: error instanceof Error ? error.message : 'Telemetry collector is not configured.'
    };
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function containsForbiddenTelemetryText(serialized: string) {
  return /password|token|api[_-]?key|secret|mediaRoot|backupRoot|downloadsRoot|musicRoot|plex_config|jellyfin_config|hostname|domain|email/i.test(
    serialized
  );
}

function json(body: unknown, init: ResponseInit) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(body, { ...init, headers });
}
