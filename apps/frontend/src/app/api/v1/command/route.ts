import { createQueuedTask, getCommand } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';
import { runQueuedTask } from '../../../../lib/runner';

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const command = getCommand(String(body.name ?? body.commandName ?? ''));

  if (!command) {
    return json({ message: 'Unknown command' }, { status: 400 });
  }

  if (command.disruptive && body.confirmed !== true) {
    return json(
      {
        message: 'Confirmation required',
        commandName: command.name,
        disruptive: true
      },
      { status: 409 }
    );
  }

  const task = createQueuedTask(command.name, command.label);
  runQueuedTask(task, command);

  return json(task, { status: 202 });
}
