import fs from 'node:fs';
import {
  changedEnvironmentKeys,
  commandRegistry,
  composePath,
  composeServicesAffectedByEnvironment,
  createQueuedTask,
  getServiceConfigAction,
  readEnv,
  readSettings,
  updateServiceConfigAction
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../../lib/api';
import { portlessHostActionIfNeeded } from '../../../../../../lib/portlessSetup';
import { runQueuedTask } from '../../../../../../lib/runner';

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
  const beforeEnv = readEnv();
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
  const portlessHostAction =
    service === 'stackarr'
      ? portlessHostActionIfNeeded(beforeSettings, afterSettings)
      : portlessHostActionIfNeeded(beforeSettings, afterSettings, {
          force: forcePortlessSync
        });

  const afterEnv = result.accepted ? readEnv() : beforeEnv;
  const changedKeys = result.accepted ? changedEnvironmentKeys(beforeEnv, afterEnv) : [];
  const composeSource = fs.readFileSync(composePath, 'utf8');
  const runtimeApplyTargets = composeServicesAffectedByEnvironment(composeSource, changedKeys);
  let runtimeApplyTask: ReturnType<typeof createQueuedTask> | undefined;
  if (runtimeApplyTargets.length > 0) {
    const definition = commandRegistry.ServiceRuntimeApply;
    const command = {
      ...definition,
      args: [...definition.args, ...runtimeApplyTargets]
    };
    runtimeApplyTask = createQueuedTask(
      command.name,
      `Apply ${runtimeApplyTargets.map((target) => target.replace('-ml', ' ML')).join(', ')} settings`
    );
    runQueuedTask(runtimeApplyTask, command);
  }

  return json({
    ...result,
    portlessHostAction: portlessHostAction ?? undefined,
    runtimeApplyTask: runtimeApplyTask ?? undefined,
    runtimeApplyTargets
  });
}
