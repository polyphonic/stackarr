import { getStackMetrics, readEnv } from '@stackarr/core';
import { json } from '../../../../lib/api';

export async function GET() {
  const env = readEnv();
  const roots = [env.MEDIA_ROOT, env.MUSIC_ROOT, env.DOWNLOADS_ROOT, env.BACKUP_ROOT].filter(Boolean) as string[];

  return json(getStackMetrics(roots).disks);
}
