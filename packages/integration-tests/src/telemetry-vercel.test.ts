import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  checkTelemetryRateLimit,
  telemetryRateLimitIdentifier
} from '../../../apps/docs/src/app/api/telemetry/rate-limit.ts';

const requireDocs = createRequire(new URL('../../../apps/docs/package.json', import.meta.url));
const { Ratelimit } = requireDocs('@upstash/ratelimit');
const { NextRequest } = requireDocs('next/server');
const config = {
  ingestKey: 'rate-limit-test-signing-key-long-enough',
  rateLimit: { url: 'https://redis.example.test', token: 'test-token' }
};

test('Vercel limiter returns without waiting for analytics and retains throttling headers', async (t) => {
  const previousEnv = { VERCEL: process.env.VERCEL, DEPLOYMENT_PLATFORM: process.env.DEPLOYMENT_PLATFORM };
  process.env.VERCEL = '1';
  process.env.DEPLOYMENT_PLATFORM = 'cloudflare';
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const identifiers: string[] = [];
  const background: Promise<unknown>[] = [];
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const contextKey = Symbol.for('@vercel/request-context');
  const globals = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const previous = globals[contextKey];
  globals[contextKey] = { get: () => ({ waitUntil: (promise: Promise<unknown>) => background.push(promise) }) };
  t.after(() => {
    complete();
    globals[contextKey] = previous;
  });
  t.mock.method(Ratelimit, 'slidingWindow', (limit: number) => () => ({
    limit: async (_context: unknown, identifier: string) => {
      identifiers.push(identifier);
      return { success: false, limit, remaining: 0, reset: Date.now() + 60_000, pending };
    }
  }));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{ result: 1 }])));
  const request = new NextRequest('https://example.test/api/telemetry/register', {
    headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '198.51.100.9' }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    checkTelemetryRateLimit(request, config, 'registration'),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Limiter waited for background work')), 200);
    })
  ]).finally(() => clearTimeout(timer));
  assert.equal(result.allowed, false);
  assert.equal(result.headers['RateLimit-Limit'], '10');
  assert.equal(result.headers['RateLimit-Remaining'], '0');
  assert.ok(Number(result.headers['Retry-After']) > 0);
  assert.ok(identifiers[0].endsWith(telemetryRateLimitIdentifier('registration', '203.0.113.7', config.ingestKey)));
  assert.equal(background.length, 1);
  complete();
  await Promise.all(background);
});

test('Cloudflare still uses its connecting IP and waits for pending work', async (t) => {
  const previousVercel = process.env.VERCEL;
  const previousPlatform = process.env.DEPLOYMENT_PLATFORM;
  delete process.env.VERCEL;
  process.env.DEPLOYMENT_PLATFORM = 'cloudflare';
  t.after(() => {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousPlatform === undefined) delete process.env.DEPLOYMENT_PLATFORM;
    else process.env.DEPLOYMENT_PLATFORM = previousPlatform;
  });
  let identifier = '';
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  t.after(() => complete());
  t.mock.method(Ratelimit, 'slidingWindow', (limit: number) => () => ({
    limit: async (_context: unknown, key: string) => {
      identifier = key;
      return { success: true, limit, remaining: limit - 1, reset: Date.now() + 60_000, pending };
    }
  }));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{ result: 1 }])));
  const request = new NextRequest('https://example.test/api/telemetry/events', {
    headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '198.51.100.9' }
  });
  let settled = false;
  const response = checkTelemetryRateLimit(
    request,
    {
      ...config,
      rateLimit: { ...config.rateLimit, token: 'cloudflare-test-token' }
    },
    'ingest'
  ).then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  complete();
  const result = await response;
  assert.equal(result.allowed, true);
  assert.equal(result.headers['RateLimit-Limit'], '60');
  assert.equal(result.headers['Retry-After'], undefined);
  assert.ok(identifier.endsWith(telemetryRateLimitIdentifier('ingest', '198.51.100.9', config.ingestKey)));
});

test('Upstash timeouts fail closed even when analytics has not completed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Ratelimit, 'slidingWindow', () => () => ({ limit: () => new Promise(() => {}) }));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{ result: 1 }])));
  const response = checkTelemetryRateLimit(
    new NextRequest('https://example.test/api/telemetry/events'),
    {
      ...config,
      rateLimit: { ...config.rateLimit, token: 'timeout-test-token' }
    },
    'ingest'
  );
  const assertion = assert.rejects(response, /Telemetry rate limiting timed out/);
  t.mock.timers.tick(5001);
  await assertion;
});
