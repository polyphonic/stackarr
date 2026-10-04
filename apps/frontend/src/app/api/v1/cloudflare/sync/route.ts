import { redactEnv } from '@stackarr/core';
import { syncCloudflareRuntimeConfig } from '@stackarr/core/cloudflareSync';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  try {
    const result = await syncCloudflareRuntimeConfig();
    return json({ ...result, config: redactEnv(result.config) });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Cloudflare settings sync failed.'
      },
      { status: 502 }
    );
  }
}
