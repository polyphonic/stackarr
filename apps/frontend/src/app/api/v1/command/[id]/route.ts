import { readTasks } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const params = await context.params;
  const task = readTasks().find((item) => item.id === params.id);

  if (!task) {
    return json({ message: 'Not found' }, { status: 404 });
  }

  return json(task);
}
