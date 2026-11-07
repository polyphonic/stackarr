import { executeAuditedHttpInstanceMutation, executeInstanceOperation } from '@stackarr/core/instanceOperations';
import { InstanceActionError } from '@stackarr/core/instances';
import type { NextRequest } from 'next/server';
import { json } from '../../../../lib/api';
import { authorized, draftBody, draftError } from '../instance-http';

export async function GET(request: NextRequest) {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    const query = request.nextUrl.searchParams;
    const limit = query.get('limit');
    if ([...query.keys()].some((key) => key !== 'limit' && key !== 'cursor'))
      throw new InstanceActionError('invalid_input', 'Invalid query parameter.');
    return json(
      executeInstanceOperation('list', {
        limit: limit === null ? undefined : Number(limit),
        cursor: query.get('cursor') ?? undefined
      })
    );
  } catch (error) {
    return draftError(error);
  }
}
export async function POST(request: NextRequest) {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    return json(await executeAuditedHttpInstanceMutation('create', await draftBody(request)), { status: 201 });
  } catch (error) {
    return draftError(error);
  }
}
