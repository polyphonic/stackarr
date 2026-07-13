import { createHmac, timingSafeEqual } from 'node:crypto';

const audience = 'stackarr-telemetry';
const tokenLifetimeMs = 180 * 24 * 60 * 60 * 1000;

type TelemetryTokenClaims = {
  audience: typeof audience;
  installId: string;
  issuedAt: number;
  expiresAt: number;
};

export function issueTelemetryClientToken(installId: string, signingKey: string, now = Date.now()) {
  const claims: TelemetryTokenClaims = {
    audience,
    installId,
    issuedAt: now,
    expiresAt: now + tokenLifetimeMs
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign(payload, signingKey);

  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(claims.expiresAt).toISOString()
  };
}

export function verifyTelemetryClientToken(
  token: string,
  signingKey: string,
  expectedInstallId: string,
  now = Date.now()
) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, signingKey))) {
    return false;
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TelemetryTokenClaims>;
    return Boolean(
      claims.audience === audience &&
        claims.installId === expectedInstallId &&
        typeof claims.issuedAt === 'number' &&
        claims.issuedAt <= now + 5 * 60 * 1000 &&
        typeof claims.expiresAt === 'number' &&
        claims.expiresAt > now
    );
  } catch {
    return false;
  }
}

export function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sign(payload: string, signingKey: string) {
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}
