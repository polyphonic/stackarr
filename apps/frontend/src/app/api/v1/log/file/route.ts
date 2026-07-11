import fs from 'node:fs';
import path from 'node:path';
import { readEnv, redactString } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const env = readEnv();
  const logRoot = env.LOG_ROOT ?? (env.APP_ROOT ? path.join(env.APP_ROOT, 'logs') : '');

  if (!logRoot || !fs.existsSync(logRoot)) {
    return json([]);
  }

  const requestedFile = request.nextUrl.searchParams.get('filename')?.trim();
  if (requestedFile) {
    const resolvedRoot = fs.realpathSync(logRoot);
    const candidateFile = path.resolve(resolvedRoot, requestedFile);
    const resolvedFile = fs.existsSync(candidateFile) ? fs.realpathSync(candidateFile) : candidateFile;
    if (
      (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) && resolvedFile !== resolvedRoot) ||
      !resolvedFile.endsWith('.log') ||
      !fs.existsSync(resolvedFile) ||
      !fs.lstatSync(candidateFile).isFile() ||
      !fs.statSync(resolvedFile).isFile()
    ) {
      return json({ message: 'Log file was not found.' }, { status: 404 });
    }

    const requestedLines = Number(request.nextUrl.searchParams.get('lines') ?? 200);
    const lineLimit = Number.isFinite(requestedLines) ? Math.min(500, Math.max(20, Math.floor(requestedLines))) : 200;
    return json(readLogTail(resolvedFile, resolvedRoot, lineLimit));
  }

  const files = walk(logRoot)
    .filter((file) => file.endsWith('.log'))
    .map((file) => {
      const stat = fs.statSync(file);

      return {
        filename: path.relative(logRoot, file),
        size: stat.size,
        lastWriteTime: stat.mtime.toISOString()
      };
    });

  return json(files);
}

function readLogTail(file: string, root: string, lineLimit: number) {
  const stat = fs.statSync(file);
  const byteLimit = 256 * 1024;
  const bytesToRead = Math.min(stat.size, byteLimit);
  const buffer = Buffer.alloc(bytesToRead);
  const descriptor = fs.openSync(file, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
  } finally {
    fs.closeSync(descriptor);
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

function walk(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(root, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(next) : entry.isFile() ? [next] : [];
  });
}
