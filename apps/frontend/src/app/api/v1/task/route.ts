import { readTasks, setTaskReviewState } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  return json(readTasks());
}

export async function PATCH(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ message: 'A JSON request body is required.' }, { status: 400 });
  }

  const source = body as Record<string, unknown>;
  const ids = Array.isArray(source.ids)
    ? source.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128).slice(0, 100)
    : [];
  if (ids.length === 0 || typeof source.reviewed !== 'boolean') {
    return json({ message: 'Choose one or more failed actions and a review state.' }, { status: 400 });
  }

  const tasks = setTaskReviewState(ids, source.reviewed);
  if (tasks.length === 0) {
    return json({ message: 'No failed or blocked actions matched this request.' }, { status: 404 });
  }

  return json({ tasks, updated: tasks.length });
}
