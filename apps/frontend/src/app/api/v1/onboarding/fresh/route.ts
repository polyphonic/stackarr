import { commandRegistry, createQueuedTask } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';
import { runInitialSetupTask } from '../../../../../lib/runner';

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

  const task = createQueuedTask(commandRegistry.StackStart.name, 'Initial setup');
  runInitialSetupTask(task, {
    configureSeerr: body.configureSeerr === true,
    installBackup: body.installBackup === true,
    installUpdates: body.installUpdates === true
  });

  return json(task, { status: 202 });
}
