import { timingSafeEqual } from 'node:crypto';
import type { TelemetryPayload } from '@stackarr/db';
import type { NextRequest } from 'next/server';
import { getTelemetryCollectorConfig } from '../../../../env/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const config = telemetryCollectorConfig();
  if (!config.enabled) {
    const error = 'error' in config ? config.error : undefined;
    return json({ accepted: false, error: error ?? 'Telemetry collector is disabled.' }, { status: error ? 503 : 404 });
  }

  const authError = authenticate(request, config.ingestKey);
  if (authError) {
    return json(authError.body, { status: authError.status });
  }

  const payload = await request.json().catch(() => null);
  const validationError = validateTelemetryPayload(payload, config.maxPayloadBytes);
  if (validationError) {
    return json({ accepted: false, error: validationError }, { status: 400 });
  }

  try {
    const { recordTelemetryEvent } = await import('@stackarr/db');
    const result = await recordTelemetryEvent({ payload: payload as TelemetryPayload });
    return json(result, { status: 202 });
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

function authenticate(request: NextRequest, expected: string) {
  const actual =
    bearerToken(request.headers.get('authorization')) || request.headers.get('x-stackarr-telemetry-key') || '';

  if (!safeEqual(actual, expected)) {
    return { status: 401, body: { accepted: false, error: 'Unauthorized.' } };
  }

  return undefined;
}

function bearerToken(value: string | null) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
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

  if (payload.schemaVersion !== 1) return 'Unsupported telemetry schemaVersion.';
  if (payload.eventName !== 'stackarr.heartbeat') return 'Unsupported telemetry eventName.';
  if (!stringValue(payload.eventId, 128)) return 'Telemetry eventId is required.';
  if (!stringValue(payload.generatedAt, 64)) return 'Telemetry generatedAt is required.';
  if (!install || !stringValue(install.id, 128)) return 'Telemetry install.id is required.';
  if (!install || !stringValue(install.channel, 64)) return 'Telemetry install.channel is required.';
  if (!install || !stringValue(install.appVersion, 64)) return 'Telemetry install.appVersion is required.';
  if (!install || !stringValue(install.osFamily, 32)) return 'Telemetry install.osFamily is required.';
  if (!install || !stringValue(install.arch, 32)) return 'Telemetry install.arch is required.';
  if (!setup || !stringValue(setup.installMode, 32)) return 'Telemetry setup.installMode is required.';
  if (!setup || !stringValue(setup.databaseMode, 32)) return 'Telemetry setup.databaseMode is required.';
  if (!services || !Array.isArray(services.enabled)) return 'Telemetry services.enabled must be an array.';
  if (!services || !objectValue(services.mediaServers)) return 'Telemetry services.mediaServers is required.';
  if (!backups) return 'Telemetry backups object is required.';
  if (!counts) return 'Telemetry counts object is required.';

  const serialized = JSON.stringify(payload);
  if (serialized.length > maxPayloadBytes) return 'Telemetry payload is too large.';
  if (containsForbiddenTelemetryText(serialized)) return 'Telemetry payload contains forbidden sensitive fields.';

  return undefined;
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
  return Response.json(body, init);
}
