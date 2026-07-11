import { getHomelabPerformanceAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;
  return json(await getHomelabPerformanceAction());
}
