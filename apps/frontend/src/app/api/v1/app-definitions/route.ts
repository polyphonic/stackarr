import { executeInstanceOperation } from '@stackarr/core/instanceOperations';
import type { NextRequest } from 'next/server';
import { json } from '../../../../lib/api';
import { authorized, draftError } from '../instance-http';

export async function GET(request: NextRequest) {
  const auth = authorized(request);
  if (auth) return auth;
  try {
    return json(executeInstanceOperation('catalog'));
  } catch (error) {
    return draftError(error);
  }
}
