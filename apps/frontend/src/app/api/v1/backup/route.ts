import fs from 'node:fs';
import path from 'node:path';
import { readEnv } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const env = readEnv();
  const backupRoot = env.BACKUP_ROOT;

  if (!backupRoot || !fs.existsSync(backupRoot)) {
    return json([]);
  }

  const backups = fs
    .readdirSync(backupRoot)
    .filter((file) => /\.(tar\.gz|tgz)(?:\.enc)?$|\.zip$/i.test(file))
    .map((file) => {
      const filePath = path.join(backupRoot, file);
      const stat = fs.statSync(filePath);

      return {
        name: file,
        path: filePath,
        size: stat.size,
        time: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.time.localeCompare(a.time));

  return json(backups);
}
