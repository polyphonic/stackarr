import { exportBackupRecoveryKeyAction, readEnv, readSettings } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import {
  checkStackarrLoginRateLimit,
  hasValidStackarrSession,
  json,
  recordStackarrLoginAttempt,
  requireApiKey,
  validateStackarrLogin
} from '../../../../../lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  try {
    const env = readEnv();
    if (readSettings().host.authenticationMethod === 'forms' && !hasValidStackarrSession(request, env)) {
      return json({ message: 'Sign in to the dashboard before exporting the recovery key.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const identifier = env.USERNAME?.trim() || env.USER_EMAIL?.trim() || '';
    const password = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const rateLimit = checkStackarrLoginRateLimit(request, identifier);
    if (rateLimit) {
      return json(
        { message: rateLimit.message },
        { status: 429, headers: { 'retry-after': String(rateLimit.retryAfter) } }
      );
    }

    const validation = identifier ? validateStackarrLogin(identifier, password) : undefined;
    recordStackarrLoginAttempt(request, identifier, Boolean(validation?.ok));
    if (!validation?.ok) {
      return json({ message: 'Current admin password is required to export the recovery key.' }, { status: 403 });
    }

    const exported = await exportBackupRecoveryKeyAction();
    return new Response(new TextEncoder().encode(exported.contents), {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'content-disposition': `attachment; filename="${exported.fileName}"`,
        'content-type': 'text/plain; charset=utf-8',
        expires: '0',
        pragma: 'no-cache',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-stackarr-key-exported-at': exported.exportedAt
      }
    });
  } catch (error) {
    return json(
      { message: error instanceof Error ? error.message : 'The recovery key could not be exported.' },
      { status: 409 }
    );
  }
}
