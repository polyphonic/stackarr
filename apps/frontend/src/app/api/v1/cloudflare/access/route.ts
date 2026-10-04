import { redactEnv } from '@stackarr/core';
import { publishCloudflareEmailAllowlist } from '@stackarr/core/cloudflareSync';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function PUT(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.allowedEmails)) {
    return json({ error: 'allowedEmails must be an array.' }, { status: 400 });
  }

  try {
    const result = await publishCloudflareEmailAllowlist(body.allowedEmails);
    return json({ ...result, config: redactEnv(result.config) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Cloudflare email allowlist publish failed.' },
      { status: 502 }
    );
  }
}
