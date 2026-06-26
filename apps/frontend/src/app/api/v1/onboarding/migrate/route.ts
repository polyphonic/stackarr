import { commandRegistry, createQueuedTask, migrateCurrentStackAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';
import { runQueuedTask } from '../../../../../lib/runner';

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const sourceRoot = typeof body.sourceRoot === 'string' && body.sourceRoot.trim() ? body.sourceRoot.trim() : undefined;
  const stopSourceContainers = body.stopSourceContainers !== false;
  const overwrite = body.overwrite === true;

  if (body.dryRun !== false) {
    const result = await migrateCurrentStackAction({
      dryRun: true,
      sourceRoot,
      stopSourceContainers,
      overwrite
    });

    return json(result);
  }

  if (body.confirmed !== true) {
    return json(
      {
        message: 'Confirmation required',
        commandName: commandRegistry.MigrateCurrentStack.name,
        disruptive: true
      },
      { status: 409 }
    );
  }

  const args = ['migrate', 'run', '--yes'];
  if (sourceRoot) args.push('--source-root', sourceRoot);
  if (!stopSourceContainers) args.push('--no-stop-source');
  if (overwrite) args.push('--overwrite');

  const command = {
    ...commandRegistry.MigrateCurrentStack,
    args
  };
  const task = createQueuedTask(command.name, command.label);
  runQueuedTask(task, command);

  return json(task, { status: 202 });
}
