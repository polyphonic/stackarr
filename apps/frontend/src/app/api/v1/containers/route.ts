import { getDockerOverviewAction, manageDockerResourceAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return json(await getDockerOverviewAction());
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));

  try {
    return json(
      await manageDockerResourceAction({
        kind: body.kind,
        action: body.action,
        id: body.id,
        force: body.force === true,
        deleteVolumes: body.deleteVolumes === true,
        confirmDangerous: body.confirmDangerous === true,
        reason: typeof body.reason === 'string' ? body.reason : undefined
      })
    );
  } catch (error) {
    return json({ accepted: false, message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
