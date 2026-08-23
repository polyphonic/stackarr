import { getAppHealthSummaryAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  return json(await getAppHealthSummaryAction(), {
    headers: { 'cache-control': 'no-store, max-age=0' }
  });
}
