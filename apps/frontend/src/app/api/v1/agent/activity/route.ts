import { listAgentActivityRecords } from '@stackarr/core';
import { json } from '../../../../../lib/api';

export async function GET() {
  return json({ activity: await listAgentActivityRecords(100) });
}
