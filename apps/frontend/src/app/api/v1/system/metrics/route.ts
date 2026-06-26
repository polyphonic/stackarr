import { getStackMetrics, readEnv } from '@stackarr/core';
import { json } from '../../../../../lib/api';

export async function GET() {
  const env = readEnv();
  return json(
    getStackMetrics([env.MEDIA_ROOT ?? '', env.MUSIC_ROOT ?? '', env.DOWNLOADS_ROOT ?? '', env.BACKUP_ROOT ?? ''])
  );
}
