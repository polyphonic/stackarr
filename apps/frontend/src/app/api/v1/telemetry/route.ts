import {
  getTelemetryStatusAction,
  previewTelemetryPayloadAction,
  sendTelemetryAction,
  updateTelemetryConfigAction
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  return json(getTelemetryStatusAction());
}

export async function PUT(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const result = updateTelemetryConfigAction({
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    endpoint: typeof body.endpoint === 'string' ? body.endpoint : undefined,
    channel: typeof body.channel === 'string' ? body.channel : undefined,
    confirmTelemetry: body.confirmTelemetry === true
  });

  return json(result, { status: result.accepted ? 200 : 400 });
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));

  if (body.preview === true) {
    return json(previewTelemetryPayloadAction());
  }

  const result = await sendTelemetryAction({
    dryRun: body.dryRun !== false,
    force: body.force === true
  });

  return json(result, { status: result.accepted ? 200 : 400 });
}
