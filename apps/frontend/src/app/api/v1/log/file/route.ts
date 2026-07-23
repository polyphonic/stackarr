import fs from 'node:fs/promises';
import path from 'node:path';
import { readEnv, redactString } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

type LogFileSummary = { filename: string; size: number; lastWriteTime: string };
let fileListCache: { root: string; expiresAt: number; files: LogFileSummary[] } | undefined;

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const env = readEnv();
  const logRoot = env.LOG_ROOT ?? (env.APP_ROOT ? path.join(env.APP_ROOT, 'logs') : '');
  if (!logRoot) return json([]);

  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(logRoot);
  } catch {
    return json([]);
  }

  const requestedFile = request.nextUrl.searchParams.get('filename')?.trim();
  if (requestedFile) {
    const resolvedFile = await safeLogPath(resolvedRoot, requestedFile);
    if (!resolvedFile) return json({ message: 'Log file was not found.' }, { status: 404 });

    const requestedLines = Number(request.nextUrl.searchParams.get('lines') ?? 120);
    const lineLimit = Number.isFinite(requestedLines) ? Math.min(500, Math.max(20, Math.floor(requestedLines))) : 120;
    return json(await readLogTail(resolvedFile, resolvedRoot, lineLimit));
  }

  const now = Date.now();
  if (fileListCache?.root === resolvedRoot && fileListCache.expiresAt > now) {
    return json(fileListCache.files);
  }

  const paths = (await walk(resolvedRoot)).filter((file) => file.endsWith('.log'));
  const files = (
    await Promise.all(
      paths.map(async (file) => {
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile()) return undefined;
          return {
            filename: path.relative(resolvedRoot, file),
            size: stat.size,
            lastWriteTime: stat.mtime.toISOString()
          };
        } catch {
          return undefined;
        }
      })
    )
  )
    .filter((file): file is LogFileSummary => Boolean(file))
    .sort((left, right) => right.lastWriteTime.localeCompare(left.lastWriteTime));

  fileListCache = { root: resolvedRoot, expiresAt: now + 5_000, files };
  return json(files);
}

async function safeLogPath(root: string, requestedFile: string) {
  const candidate = path.resolve(root, requestedFile);
  if ((!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) || !candidate.endsWith('.log'))
    return undefined;
  try {
    const resolved = await fs.realpath(candidate);
    if (!resolved.startsWith(`${root}${path.sep}`) || !resolved.endsWith('.log')) return undefined;
    const stat = await fs.stat(resolved);
    return stat.isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function readLogTail(file: string, root: string, lineLimit: number) {
  const stat = await fs.stat(file);
  const byteLimit = 256 * 1024;
  const bytesToRead = Math.min(stat.size, byteLimit);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await fs.open(file, 'r');
  try {
    await handle.read(buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
  } finally {
    await handle.close();
  }

  let lines = buffer.toString('utf8').split(/\r?\n/);
  if (stat.size > bytesToRead) lines = lines.slice(1);
  lines = lines.filter(Boolean).slice(-lineLimit).map(redactString);
  return {
    filename: path.relative(root, file),
    lastWriteTime: stat.mtime.toISOString(),
    size: stat.size,
    truncated: stat.size > bytesToRead || lines.length >= lineLimit,
    lines
  };
}

async function walk(root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const next = path.join(root, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) return walk(next, depth + 1);
      return entry.isFile() ? [next] : [];
    })
  );
  return nested.flat().slice(0, 5_000);
}
