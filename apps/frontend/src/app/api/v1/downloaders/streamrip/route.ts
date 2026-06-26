import {
  listStreamripJobsAction,
  startStreamripDownloadAction,
  testStreamripAction
} from '@stackarr/core/actions/streamrip';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET() {
  const test = await testStreamripAction();
  return json({ ...test, jobs: listStreamripJobsAction().jobs });
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === 'string' ? body.url.trim() : '';

  if (!url) {
    return json({ message: 'Streamrip album URL is required.' }, { status: 400 });
  }

  try {
    return json(await startStreamripDownloadAction({ url }));
  } catch (error) {
    return json(
      { message: error instanceof Error ? error.message : 'Could not start Streamrip download.' },
      { status: 400 }
    );
  }
}
