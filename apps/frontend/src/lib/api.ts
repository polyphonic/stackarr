import { readEnv } from '@stackarr/core';
import { NextRequest, NextResponse } from 'next/server';

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function requireApiKey(request: NextRequest) {
  const env = readEnv();
  const expected = env.STACKARR_API_KEY?.trim();
  const actual = request.headers.get('x-api-key') ?? request.nextUrl.searchParams.get('apikey');

  if (!expected) {
    return json({ message: 'Stackarr API key is not configured.' }, { status: 503 });
  }

  if (actual === expected) {
    return null;
  }

  return json({ message: 'Unauthorized' }, { status: 401 });
}
