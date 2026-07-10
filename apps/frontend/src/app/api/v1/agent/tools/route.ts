import { getMcpServiceSelection, getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const profile = resolveMcpProfile();
  const selection = getMcpServiceSelection();
  return json({
    profile,
    catalogMode: selection.catalogMode,
    onboardingComplete: selection.onboardingComplete,
    enabledServices: selection.enabledServices,
    tools: getMcpToolCatalog({ profile, enabledServices: selection.enabledServices })
  });
}
