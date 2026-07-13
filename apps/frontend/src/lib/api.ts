import crypto from 'node:crypto';
import { readEnv, readSettings, writeEnvConfig } from '@stackarr/core';
import { NextRequest, NextResponse } from 'next/server';

const sessionCookieName = 'stackarr_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const loginWindowMs = 15 * 60 * 1000;
const loginBlockMs = 15 * 60 * 1000;
const loginMaxFailures = 5;
const loginAttemptBuckets = new Map<
  string,
  {
    failures: number;
    resetAt: number;
    blockedUntil: number;
  }
>();

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function requireApiKey(request: NextRequest) {
  const env = readEnv();
  const settings = readSettingsSafe();
  const authenticationMethod = settings?.host.authenticationMethod ?? 'forms';

  if (authenticationMethod === 'none') {
    return null;
  }

  const expected = env.STACKARR_API_KEY?.trim();
  const actual = request.headers.get('x-api-key') ?? request.nextUrl.searchParams.get('apikey');

  if (expected && actual && secretEqual(actual, expected)) {
    return null;
  }

  if (validStackarrSession(request, env)) {
    return null;
  }

  if (!expected) {
    return json({ message: 'Stackarr API key is not configured.' }, { status: 503 });
  }

  return json({ message: 'Authentication required', authenticationMethod }, { status: 401 });
}

export function stackarrSessionCookie() {
  return sessionCookieName;
}

export function validateStackarrLogin(identifier: string, password: string) {
  const env = readEnv();
  const configuredPassword = env.PASSWORD?.trim();

  if (!configuredPassword) {
    return { ok: false as const, status: 503, message: 'Stackarr password is not configured.' };
  }

  const requestedUser = identifier.trim().toLowerCase();
  const allowedUsers = [env.USERNAME, env.USER_EMAIL]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));

  if (!requestedUser || allowedUsers.length === 0 || !allowedUsers.includes(requestedUser)) {
    return { ok: false as const, status: 401, message: 'Invalid username or password.' };
  }

  if (!secretEqual(password, configuredPassword)) {
    return { ok: false as const, status: 401, message: 'Invalid username or password.' };
  }

  return {
    ok: true as const,
    env,
    username: env.USERNAME?.trim() || requestedUser,
    email: env.USER_EMAIL?.trim() || ''
  };
}

export function checkStackarrLoginRateLimit(request: NextRequest, identifier: string) {
  const key = loginRateLimitKey(request, identifier);
  const bucket = loginAttemptBuckets.get(key);
  const now = Date.now();

  if (!bucket) {
    return null;
  }

  if (bucket.resetAt <= now) {
    loginAttemptBuckets.delete(key);
    return null;
  }

  if (bucket.blockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    return {
      retryAfter,
      message: 'Too many failed sign-in attempts. Try again later.'
    };
  }

  return null;
}

export function recordStackarrLoginAttempt(request: NextRequest, identifier: string, ok: boolean) {
  const key = loginRateLimitKey(request, identifier);

  if (ok) {
    loginAttemptBuckets.delete(key);
    return;
  }

  const now = Date.now();
  const existing = loginAttemptBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : {
          failures: 0,
          resetAt: now + loginWindowMs,
          blockedUntil: 0
        };

  bucket.failures += 1;
  if (bucket.failures >= loginMaxFailures) {
    bucket.blockedUntil = now + loginBlockMs;
  }

  loginAttemptBuckets.set(key, bucket);
  pruneLoginAttemptBuckets(now);
}

export function setStackarrSessionCookie(
  response: NextResponse,
  request: NextRequest,
  env: ReturnType<typeof readEnv> = readEnv()
) {
  const sessionEnv = ensureStackarrSessionSecret(env);
  const token = signSessionToken(sessionEnv);

  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(request),
    maxAge: sessionMaxAgeSeconds,
    path: '/'
  });

  return response;
}

export function clearStackarrSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  });

  return response;
}

export function stackarrAuthStatus(request: NextRequest) {
  const env = readEnv();
  const settings = readSettingsSafe();
  const authenticationMethod = settings?.host.authenticationMethod ?? 'forms';
  const authenticated = authenticationMethod === 'none' || validStackarrSession(request, env);

  return {
    authenticationMethod,
    authenticated,
    username: authenticated ? env.USERNAME?.trim() || '' : '',
    email: authenticated ? env.USER_EMAIL?.trim() || '' : '',
    apiKeyConfigured: Boolean(env.STACKARR_API_KEY?.trim()),
    passwordConfigured: Boolean(env.PASSWORD?.trim())
  };
}

export function validStackarrSessionToken(token: string | undefined, env = readEnv()) {
  if (!token) {
    return false;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      subject?: unknown;
      sessionVersion?: unknown;
      username?: unknown;
      expiresAt?: unknown;
    };
    const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0;
    if (expiresAt <= Date.now()) {
      return false;
    }

    if (data.subject === 'stackarr-owner') {
      const secret = env.STACKARR_SESSION_SECRET?.trim();
      return Boolean(
        secret &&
          data.sessionVersion === stackarrSessionVersion(env) &&
          secretEqual(signature, signPayload(payload, secret))
      );
    }

    const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    const allowedUsers = [env.USERNAME, env.USER_EMAIL].map((value) => value?.trim().toLowerCase()).filter(Boolean);
    const legacySecrets = [env.STACKARR_API_KEY?.trim(), env.PASSWORD?.trim()].filter((value): value is string =>
      Boolean(value)
    );

    return Boolean(
      username &&
        allowedUsers.includes(username) &&
        legacySecrets.some((secret) => secretEqual(signature, signPayload(payload, secret)))
    );
  } catch {
    return false;
  }
}

export function hasValidStackarrSession(request: NextRequest, env: ReturnType<typeof readEnv> = readEnv()) {
  return validStackarrSessionToken(request.cookies.get(sessionCookieName)?.value, env);
}

function validStackarrSession(request: NextRequest, env: ReturnType<typeof readEnv>) {
  return hasValidStackarrSession(request, env);
}

function signSessionToken(env: ReturnType<typeof readEnv>) {
  const secret = env.STACKARR_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error('Stackarr session secret is not configured.');
  }

  const payload = Buffer.from(
    JSON.stringify({
      subject: 'stackarr-owner',
      sessionVersion: stackarrSessionVersion(env),
      expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
    })
  ).toString('base64url');

  return `${payload}.${signPayload(payload, secret)}`;
}

function signPayload(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function ensureStackarrSessionSecret(env: ReturnType<typeof readEnv>) {
  if (env.STACKARR_SESSION_SECRET?.trim()) {
    return env;
  }

  return writeEnvConfig({ STACKARR_SESSION_SECRET: crypto.randomBytes(32).toString('hex') });
}

function stackarrSessionVersion(env: ReturnType<typeof readEnv>) {
  const version = Number(env.STACKARR_SESSION_VERSION);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

function secretEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isSecureRequest(request: NextRequest) {
  return request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}

function readSettingsSafe() {
  try {
    return readSettings();
  } catch {
    return null;
  }
}

function loginRateLimitKey(request: NextRequest, identifier: string) {
  const userPart = identifier.trim().toLowerCase().slice(0, 128) || '<empty>';
  return crypto
    .createHash('sha256')
    .update(`${clientAddress(request)}:${userPart}`)
    .digest('hex');
}

function clientAddress(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

function pruneLoginAttemptBuckets(now: number) {
  if (loginAttemptBuckets.size <= 500) {
    return;
  }

  for (const [key, bucket] of loginAttemptBuckets) {
    if (bucket.resetAt <= now || bucket.blockedUntil <= now) {
      loginAttemptBuckets.delete(key);
    }

    if (loginAttemptBuckets.size <= 400) {
      return;
    }
  }
}
