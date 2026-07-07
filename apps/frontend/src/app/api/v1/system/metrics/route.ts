import { getStackMetrics, readEnv } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const env = readEnv();
  return json(
    getStackMetrics([env.MEDIA_ROOT ?? '', env.MUSIC_ROOT ?? '', env.DOWNLOADS_ROOT ?? '', env.BACKUP_ROOT ?? ''])
  );
}
