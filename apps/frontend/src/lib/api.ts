import crypto from 'node:crypto';
import { readEnv, readSettings } from '@stackarr/core';
import { NextRequest, NextResponse } from 'next/server';

const sessionCookieName = 'stackarr_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function requireApiKey(request: NextRequest) {
  const env = readEnv();
  const settings = readSettingsSafe();
  const authenticationMethod = settings?.host.authenticationMethod ?? 'apikey';

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

export function setStackarrSessionCookie(response: NextResponse, request: NextRequest, username: string) {
  const env = readEnv();
  const token = signSessionToken(username, env);

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
  const authenticationMethod = settings?.host.authenticationMethod ?? 'apikey';

  return {
    authenticationMethod,
    authenticated: authenticationMethod === 'none' || validStackarrSession(request, env),
    username: env.USERNAME?.trim() || '',
    email: env.USER_EMAIL?.trim() || '',
    apiKeyConfigured: Boolean(env.STACKARR_API_KEY?.trim()),
    passwordConfigured: Boolean(env.PASSWORD?.trim())
  };
}

function validStackarrSession(request: NextRequest, env: ReturnType<typeof readEnv>) {
  const token = request.cookies.get(sessionCookieName)?.value;

  if (!token) {
    return false;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return false;
  }

  const expected = signPayload(payload, sessionSecret(env));
  if (!secretEqual(signature, expected)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      username?: unknown;
      expiresAt?: unknown;
    };
    const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0;
    const allowedUsers = [env.USERNAME, env.USER_EMAIL]
      .map((value) => value?.trim().toLowerCase())
      .filter(Boolean);

    return Boolean(username && allowedUsers.includes(username) && expiresAt > Date.now());
  } catch {
    return false;
  }
}

function signSessionToken(username: string, env: ReturnType<typeof readEnv>) {
  const payload = Buffer.from(
    JSON.stringify({
      username: username.trim().toLowerCase(),
      expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
    })
  ).toString('base64url');

  return `${payload}.${signPayload(payload, sessionSecret(env))}`;
}

function signPayload(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function sessionSecret(env: ReturnType<typeof readEnv>) {
  return env.STACKARR_API_KEY?.trim() || env.PASSWORD?.trim() || 'stackarr-session-bootstrap';
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
