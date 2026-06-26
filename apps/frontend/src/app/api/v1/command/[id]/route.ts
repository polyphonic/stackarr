import { readTasks } from '@stackarr/core';
import { json } from '../../../../../lib/api';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const task = readTasks().find((item) => item.id === params.id);

  if (!task) {
    return json({ message: 'Not found' }, { status: 404 });
  }

  return json(task);
}
