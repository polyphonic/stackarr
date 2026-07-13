import { maybeSendTelemetryHeartbeatAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) {
    return auth;
  }

  return json(await maybeSendTelemetryHeartbeatAction());
}
