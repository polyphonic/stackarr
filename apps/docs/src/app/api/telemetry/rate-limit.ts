import { createHmac } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ipAddress } from '@vercel/functions';
import type { NextRequest } from 'next/server';

export type TelemetryRateLimitPolicy = 'ingest' | 'registration';

type TelemetryRateLimitConfig = {
  ingestKey: string;
  rateLimit: {
    url: string;
    token: string;
  };
};

type CachedLimiters = {
  url: string;
  token: string;
  ingest: Ratelimit;
  registration: Ratelimit;
};

let cachedLimiters: CachedLimiters | undefined;

export async function checkTelemetryRateLimit(
  request: NextRequest,
  config: TelemetryRateLimitConfig,
  policy: TelemetryRateLimitPolicy
) {
  const address = ipAddress(request) || fallbackAddress(request);
  const identifier = telemetryRateLimitIdentifier(policy, address, config.ingestKey);
  const limiter = telemetryLimiters(config)[policy];
  const result = await limiter.limit(identifier);
  await result.pending.catch(() => undefined);

  if (result.reason === 'timeout') {
    throw new Error('Telemetry rate limiting timed out.');
  }

  const resetSeconds = Math.max(0, Math.ceil(result.reset / 1000));
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(resetSeconds)
  };

  if (!result.success) headers['Retry-After'] = String(retryAfter);

  return {
    allowed: result.success,
    headers
  };
}

export function telemetryRateLimitIdentifier(policy: TelemetryRateLimitPolicy, address: string, hashingKey: string) {
  return createHmac('sha256', hashingKey).update(`${policy}:${address}`).digest('hex');
}

function telemetryLimiters(config: TelemetryRateLimitConfig) {
  if (
    cachedLimiters &&
    cachedLimiters.url === config.rateLimit.url &&
    cachedLimiters.token === config.rateLimit.token
  ) {
    return cachedLimiters;
  }

  const redis = new Redis(config.rateLimit);
  cachedLimiters = {
    url: config.rateLimit.url,
    token: config.rateLimit.token,
    registration: new Ratelimit({
      redis,
      analytics: true,
      prefix: 'stackarr:telemetry:registration',
      limiter: Ratelimit.slidingWindow(10, '1 h')
    }),
    ingest: new Ratelimit({
      redis,
      analytics: true,
      prefix: 'stackarr:telemetry:ingest',
      limiter: Ratelimit.slidingWindow(60, '1 m')
    })
  };

  return cachedLimiters;
}

function fallbackAddress(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
