import { InstanceActionError } from '@stackarr/core/instances';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../lib/api';

export function authorized(request: NextRequest) {
  return requireApiKey(request);
}
export async function draftBody(request: NextRequest): Promise<unknown> {
  const length = Number(request.headers.get('content-length'));
  if (length > 16384) throw new InstanceActionError('invalid_input', 'Request body exceeds 16 KiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new InstanceActionError('invalid_input', 'JSON body required.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) throw new InstanceActionError('invalid_input', 'Request body exceeds 16 KiB.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new InstanceActionError('invalid_input', 'Malformed JSON.');
  }
}
export function draftError(error: unknown) {
  if (error instanceof InstanceActionError)
    return json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === 'not_found' ? 404 : error.code === 'store_unavailable' ? 503 : 400 }
    );
  return json({ error: { code: 'store_unavailable', message: 'Instance store unavailable.' } }, { status: 503 });
}
