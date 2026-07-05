import type { NextRequest } from 'next/server';
import { json, stackarrAuthStatus } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  return json(stackarrAuthStatus(request));
}
