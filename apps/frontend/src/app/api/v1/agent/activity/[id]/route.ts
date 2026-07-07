import { getAgentActivityRecord } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../../lib/api';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireApiKey(request);
  if (auth) {
    return auth;
  }

  const { id } = await params;
  const record = await getAgentActivityRecord(id);
  return json(record ?? { error: 'Not found' }, { status: record ? 200 : 404 });
}
