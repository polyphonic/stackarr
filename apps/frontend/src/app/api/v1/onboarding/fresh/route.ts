import { commandRegistry, createQueuedTask } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';
import { runInitialSetupTask } from '../../../../../lib/runner';

const supportedPlugins = new Set(['hermes', 'openclaw']);

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));

  if (body.confirmed !== true) {
    return json(
      {
        message: 'Confirmation required',
        commandName: commandRegistry.StackStart.name,
        disruptive: true
      },
      { status: 409 }
    );
  }

  const agentPluginIntegrations = Array.isArray(body.agentPluginIntegrations)
    ? body.agentPluginIntegrations.filter(
        (plugin: unknown): plugin is 'hermes' | 'openclaw' => typeof plugin === 'string' && supportedPlugins.has(plugin)
      )
    : [];

  const task = createQueuedTask(commandRegistry.StackStart.name, 'Initial setup');
  runInitialSetupTask(task, {
    configureSeerr: body.configureSeerr === true,
    installStartup: body.installStartup === true,
    installBackup: body.installBackup === true,
    installUpdates: body.installUpdates === true,
    agentPluginIntegrations
  });

  return json(task, { status: 202 });
}
