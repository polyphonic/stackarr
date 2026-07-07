import type { NextRequest } from 'next/server';
import {
  checkStackarrLoginRateLimit,
  json,
  recordStackarrLoginAttempt,
  setStackarrSessionCookie,
  validateStackarrLogin
} from '../../../../../lib/api';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const identifier = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const rateLimit = checkStackarrLoginRateLimit(request, identifier);

  if (rateLimit) {
    return json(
      { authenticated: false, message: rateLimit.message },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    );
  }

  const result = validateStackarrLogin(identifier, password);
  recordStackarrLoginAttempt(request, identifier, result.ok);

  if (!result.ok) {
    return json({ authenticated: false, message: result.message }, { status: result.status });
  }

  const response = json({
    authenticated: true,
    username: result.username,
    email: result.email
  });

  return setStackarrSessionCookie(response, request, result.username);
}
