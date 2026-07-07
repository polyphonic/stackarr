import { getServiceConfigAction, readSettings, updateServiceConfigAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../../lib/api';
import { queuePortlessSetupIfNeeded } from '../../../../../../lib/portlessSetup';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const auth = requireApiKey(_request);

  if (auth) {
    return auth;
  }

  const { service } = await params;
  return json(getServiceConfigAction({ service }));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const { service } = await params;
  const body = await request.json().catch(() => ({}));
  const beforeSettings = readSettings();
  const result = updateServiceConfigAction({
    service,
    values: body.values && typeof body.values === 'object' ? body.values : {},
    currentPassword: body.currentPassword
  });
  const afterSettings = readSettings();

  const forcePortlessSync =
    service !== 'stackarr' ||
    beforeSettings.ui.serviceUrlMode === 'portless' ||
    afterSettings.ui.serviceUrlMode === 'portless';
  const task =
    service === 'stackarr'
      ? queuePortlessSetupIfNeeded(beforeSettings, afterSettings)
      : queuePortlessSetupIfNeeded(beforeSettings, afterSettings, {
          force: forcePortlessSync
        });

  return json({ ...result, portlessTask: task ?? undefined });
}
