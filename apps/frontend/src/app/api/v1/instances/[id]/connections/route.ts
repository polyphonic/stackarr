import { executeAuditedHttpInstanceMutation, executeInstanceOperation } from '@stackarr/core/instanceOperations';
import { InstanceActionError } from '@stackarr/core/instances';
import type { NextRequest } from 'next/server';
import { json } from '../../../../../../lib/api';
import { authorized, draftBody, draftError, requireDangerousConfirmation } from '../../../instance-http';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    const query = request.nextUrl.searchParams;
    if ([...query.keys()].some((key) => key !== 'limit' && key !== 'cursor'))
      throw new InstanceActionError('invalid_input', 'Invalid query parameter.');
    if (query.getAll('limit').length > 1 || query.getAll('cursor').length > 1)
      throw new InstanceActionError('invalid_input', 'Duplicate query parameter.');
    const limit = query.get('limit');
    if ((limit !== null && !/^[0-9]+$/.test(limit)) || query.get('cursor') === '')
      throw new InstanceActionError('invalid_input', 'Invalid query parameter.');
    return json(
      executeInstanceOperation('connections', {
        instanceId: (await context.params).id,
        limit: limit === null ? undefined : Number(limit),
        cursor: query.get('cursor') ?? undefined
      })
    );
  } catch (error) {
    return draftError(error);
  }
}

async function mutate(request: NextRequest, context: Context, operation: 'connect' | 'disconnect') {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    const origin = request.headers.get('origin');
    if ((origin && origin !== request.nextUrl.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
      throw new InstanceActionError('invalid_input', 'Cross-origin mutation is not allowed.');
    if (operation === 'disconnect') requireDangerousConfirmation(request);
    const body = await draftBody(request);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.getPrototypeOf(body) !== Object.prototype ||
      Object.keys(body).some((key) => key !== 'targetId' && key !== 'kind') ||
      !Object.hasOwn(body, 'targetId') ||
      !Object.hasOwn(body, 'kind')
    )
      throw new InstanceActionError('invalid_input', 'Unexpected or missing fields.');
    return json(
      await executeAuditedHttpInstanceMutation(operation, {
        sourceId: (await context.params).id,
        targetId: (body as { targetId: unknown }).targetId,
        kind: (body as { kind: unknown }).kind
      })
    );
  } catch (error) {
    return draftError(error);
  }
}
export const POST = (request: NextRequest, context: Context) => mutate(request, context, 'connect');
export const DELETE = (request: NextRequest, context: Context) => mutate(request, context, 'disconnect');
