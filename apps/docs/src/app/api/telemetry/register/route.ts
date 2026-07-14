import type { NextRequest } from 'next/server';
import { getTelemetryCollectorConfig } from '../../../../env/server';
import { issueTelemetryClientToken } from '../auth';
import { checkTelemetryRateLimit } from '../rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const config = telemetryCollectorConfig();
  if (!config.enabled) {
    const error = 'error' in config ? config.error : undefined;
    return json({ accepted: false, error: error ?? 'Telemetry collector is disabled.' }, { status: error ? 503 : 404 });
  }

  const rateLimit = await telemetryRateLimit(request, config, 'registration');
  if (!rateLimit.ok) return rateLimit.response;
  if (!rateLimit.result.allowed) {
    return json(
      { accepted: false, error: 'Too many telemetry registrations. Try again later.' },
      { status: 429, headers: rateLimit.result.headers }
    );
  }

  const raw = await readBoundedBody(request, 2048);
  if (!raw.ok) {
    return json({ accepted: false, error: raw.error }, { status: raw.status });
  }

  const body = parseJsonObject(raw.body);
  if (!body || !hasOnlyKeys(body, ['schemaVersion', 'installId', 'appVersion'])) {
    return json({ accepted: false, error: 'Invalid telemetry registration payload.' }, { status: 400 });
  }

  if (body.schemaVersion !== 2 || !uuidValue(body.installId) || !stringValue(body.appVersion, 64)) {
    return json({ accepted: false, error: 'Invalid telemetry registration fields.' }, { status: 400 });
  }

  return json(
    {
      accepted: true,
      ...issueTelemetryClientToken(body.installId, config.ingestKey)
    },
    { status: 201, headers: rateLimit.result.headers }
  );
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

async function telemetryRateLimit(
  request: NextRequest,
  config: ReturnType<typeof getTelemetryCollectorConfig> & { enabled: true },
  policy: 'registration'
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

async function readBoundedBody(request: NextRequest, maxBytes: number) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false as const, status: 413, error: 'Telemetry registration payload is too large.' };
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    return { ok: false as const, status: 413, error: 'Telemetry registration payload is too large.' };
  }

  return { ok: true as const, body };
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
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

function stringValue(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function json(body: unknown, init: ResponseInit) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(body, { ...init, headers });
}
