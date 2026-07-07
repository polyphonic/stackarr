import { readNotifications, writeNotification } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  return json(readNotifications());
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));

  if (!body.name || !body.implementation) {
    return json({ message: 'name and implementation are required' }, { status: 400 });
  }

  return json(
    writeNotification({
      name: String(body.name),
      implementation: body.implementation === 'CustomScript' ? 'CustomScript' : 'Webhook',
      enabled: body.enabled !== false,
      url: body.url ? String(body.url) : undefined,
      path: body.path ? String(body.path) : undefined,
      events: Array.isArray(body.events) ? body.events : ['Test']
    }),
    { status: 201 }
  );
}
