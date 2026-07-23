import { listAgentActivityRecords } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) {
    return auth;
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.trunc(requestedLimit))) : 100;
  return json({ activity: await listAgentActivityRecords(limit) });
}
