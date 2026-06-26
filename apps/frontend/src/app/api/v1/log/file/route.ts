import fs from 'node:fs';
import path from 'node:path';
import { readEnv } from '@stackarr/core';
import { json } from '../../../../../lib/api';

export async function GET() {
  const env = readEnv();
  const logRoot = env.LOG_ROOT ?? (env.APP_ROOT ? path.join(env.APP_ROOT, 'logs') : '');

  if (!logRoot || !fs.existsSync(logRoot)) {
    return json([]);
  }

  const files = walk(logRoot)
    .filter((file) => file.endsWith('.log'))
    .map((file) => {
      const stat = fs.statSync(file);

      return {
        filename: path.relative(logRoot, file),
        path: file,
        size: stat.size,
        lastWriteTime: stat.mtime.toISOString()
      };
    });

  return json(files);
}

function walk(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(root, entry.name);
    return entry.isDirectory() ? walk(next) : [next];
  });
}
