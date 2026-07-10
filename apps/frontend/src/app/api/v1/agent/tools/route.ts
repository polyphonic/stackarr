import { getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const profile = resolveMcpProfile();
  return json({ profile, tools: getMcpToolCatalog({ profile }) });
}
