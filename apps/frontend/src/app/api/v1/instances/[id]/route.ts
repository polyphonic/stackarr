import { executeAuditedHttpInstanceMutation, validateInstanceRenameBody } from '@stackarr/core/instanceOperations';
import { InstanceActionError } from '@stackarr/core/instances';
import type { NextRequest } from 'next/server';
import { json } from '../../../../../lib/api';
import { authorized, draftBody, draftError, requireDangerousConfirmation } from '../../instance-http';

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    const body = validateInstanceRenameBody(await draftBody(request));
    return json(await executeAuditedHttpInstanceMutation('rename', { ...body, id: (await context.params).id }));
  } catch (error) {
    return draftError(error);
  }
}
export async function DELETE(request: NextRequest, context: Context) {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    if (request.body) throw new InstanceActionError('invalid_input', 'DELETE does not accept a request body.');
    requireDangerousConfirmation(request);
    return json(await executeAuditedHttpInstanceMutation('remove', { id: (await context.params).id }));
  } catch (error) {
    return draftError(error);
  }
}
