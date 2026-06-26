import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEnv, repoRoot } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const env = readEnv();
  const requestedPath = request.nextUrl.searchParams.get('path') || env.MEDIA_ROOT || os.homedir() || '/';
  const currentPath = normalizeAbsolutePath(requestedPath);
  const roots = directoryRoots(env);

  try {
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const entryPath = path.join(currentPath, entry.name);
        return {
          name: entry.name,
          path: entryPath,
          readable: canReadDirectory(entryPath)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return json({
      path: currentPath,
      parent: parentDirectory(currentPath),
      roots,
      entries
    });
  } catch (error) {
    return json(
      {
        path: currentPath,
        parent: parentDirectory(currentPath),
        roots,
        entries: [],
        error: error instanceof Error ? error.message : 'Could not read directory.'
      },
      { status: 400 }
    );
  }
}

function directoryRoots(env: ReturnType<typeof readEnv>) {
  const roots = [
    ['Macintosh HD', '/'],
    ['Home', os.homedir()],
    ['Volumes', '/Volumes'],
    ['Stackarr App', env.APP_ROOT],
    ['Media', env.MEDIA_ROOT],
    ['Music', env.MUSIC_ROOT],
    ['Downloads', env.DOWNLOADS_ROOT],
    ['Backups', env.BACKUP_ROOT],
    ['Repo', repoRoot]
  ] as const;
  const seen = new Set<string>();

  return roots
    .map(([label, rootPath]) => ({ label, path: normalizeAbsolutePath(rootPath || '/') }))
    .filter((root) => {
      if (seen.has(root.path) || !fs.existsSync(root.path)) {
        return false;
      }

      seen.add(root.path);
      return true;
    });
}

function normalizeAbsolutePath(value: string) {
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(expanded || '/');
}

function parentDirectory(value: string) {
  const parent = path.dirname(value);
  return parent === value ? '' : parent;
}

function canReadDirectory(value: string) {
  try {
    fs.accessSync(value, fs.constants.R_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
