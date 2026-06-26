import { readTasks } from '@stackarr/core';
import { json } from '../../../../lib/api';

export async function GET() {
  return json(readTasks());
}
