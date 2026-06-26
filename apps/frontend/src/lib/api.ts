import { readEnv } from '@stackarr/core';
import { NextRequest, NextResponse } from 'next/server';

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function requireApiKey(request: NextRequest) {
  const env = readEnv();
  const expected = env.STACKARR_API_KEY;

  if (!expected) {
    return null;
  }

  if (isSameOriginBrowserRequest(request)) {
    return null;
  }

  const actual = request.headers.get('x-api-key') ?? request.nextUrl.searchParams.get('apikey');

  if (actual === expected) {
    return null;
  }

  return json({ message: 'Unauthorized' }, { status: 401 });
}

function isSameOriginBrowserRequest(request: NextRequest) {
  const fetchSite = request.headers.get('sec-fetch-site');

  if (fetchSite === 'same-origin' && hasMatchingOriginHeader(request)) {
    return true;
  }

  return hasMatchingOriginHeader(request);
}

function hasMatchingOriginHeader(request: NextRequest) {
  return [request.headers.get('origin'), request.headers.get('referer')].some((value) =>
    value ? matchesRequestOrigin(value, request) : false
  );
}

function matchesRequestOrigin(value: string, request: NextRequest) {
  try {
    const url = new URL(value);
    const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
    const requestProtocol =
      request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(/:$/, '') ?? url.protocol;

    return url.host === requestHost && url.protocol.replace(/:$/, '') === requestProtocol;
  } catch {
    return false;
  }
}
