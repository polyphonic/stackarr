import { getAgentActivityRecord } from '@stackarr/core';
import { json } from '../../../../../../lib/api';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getAgentActivityRecord(id);
  return json(record ?? { error: 'Not found' }, { status: record ? 200 : 404 });
}
