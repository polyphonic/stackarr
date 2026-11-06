import { getDatabaseDiagnostics } from '@stackarr/core/databaseDiagnostics';
import { readEnv } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;
  try {
    return json(await getDatabaseDiagnostics(readEnv()), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return json({ message: 'Database diagnostics unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
