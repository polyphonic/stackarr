import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readEnv } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export const dynamic = 'force-dynamic';

const phases = new Set(['queued', 'planning', 'stopping', 'copying', 'starting', 'completed', 'failed']);
const setup =
  'On the Docker host, run stackarr storage prepare --yes, then stackarr storage install --yes, and stackarr storage check.';
const noStore = { 'cache-control': 'no-store' };
const response = (body: unknown, status = 200) => json(body, { status, headers: noStore });

type MoveStatus = { id: string; phase: string; destination: string; message?: string; updatedAt: string };

async function safeFile(file: string, limit = 4096) {
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > limit) throw new Error('Invalid storage control file');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit || opened.ino !== stat.ino || opened.dev !== stat.dev)
      throw new Error('Invalid storage control file');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function absolute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 1 &&
    value.length <= 1024 &&
    path.isAbsolute(value) &&
    !/[\x00-\x1f\x7f]/.test(value) &&
    !value.split('/').some((part) => part === '.' || part === '..') &&
    path.normalize(value) === value
  );
}

async function control() {
  const env = readEnv();
  const stateRoot = env.STATE_ROOT;
  const configRoot = env.CONFIG_ROOT;
  if (!absolute(stateRoot) || !absolute(configRoot))
    throw new Error('Internal state or configuration root is unavailable');
  const policy = process.env.STACKARR_STORAGE_POLICY;
  // Only the enrolled host monitor can act on this queue. Never infer enrollment from a directory alone.
  if (!policy || path.dirname(policy) !== stateRoot) throw new Error('Host storage protection is not installed');
  const root = await lstat(stateRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Internal state root is unavailable');
  const enrollmentText = await safeFile(path.join(stateRoot, 'storage-enrollment.json'));
  const policyText = await safeFile(policy, 65536);
  const enrollment = enrollmentText ? JSON.parse(enrollmentText) : null;
  if (!policyText || enrollment?.version !== 1 || enrollment.phase !== 'ready')
    throw new Error('Host storage protection is not ready');
  const dir = path.join(stateRoot, 'storage-move');
  const stat = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Invalid storage move directory');
  const bridge = path.join(stateRoot, 'storage-bridge');
  const bridgeStat = await lstat(bridge);
  if (!bridgeStat.isDirectory() || bridgeStat.isSymbolicLink()) throw new Error('Host storage monitor is unavailable');
  return { configRoot, dir, bridge, policyText, policy };
}

async function readStatus(dir: string): Promise<MoveStatus | null> {
  const text = await safeFile(path.join(dir, 'status.json'));
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('Invalid storage move status');
  const status = value as MoveStatus;
  if (
    typeof status.id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(status.id) ||
    !phases.has(status.phase) ||
    !absolute(status.destination) ||
    typeof status.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(status.updatedAt)) ||
    (status.message !== undefined && (typeof status.message !== 'string' || status.message.length > 1024))
  )
    throw new Error('Invalid storage move status');
  return {
    id: status.id,
    phase: status.phase,
    destination: status.destination,
    ...(status.message ? { message: status.message } : {}),
    updatedAt: status.updatedAt
  };
}

async function queuedRequest(dir: string): Promise<MoveStatus | null> {
  const text = await safeFile(path.join(dir, 'request.json'), 2048);
  if (!text) return null;
  const value = JSON.parse(text) as { id?: unknown; destination?: unknown; requestedAt?: unknown; version?: unknown };
  if (
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value.id) ||
    !absolute(value.destination) ||
    typeof value.requestedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new Error('Invalid storage move request');
  return { id: value.id, phase: 'queued', destination: value.destination, updatedAt: value.requestedAt };
}

async function hostReady(bridge: string, policy: string, policyText: string) {
  const nonce = randomBytes(16).toString('hex');
  const digest = createHash('sha256').update(policyText).digest('hex');
  const at = Date.now();
  const request = path.join(bridge, `${nonce}.request`);
  const reply = path.join(bridge, `${nonce}.response`);
  const handle = await open(request, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ nonce, digest, at }));
  } finally {
    await handle.close();
  }
  try {
    while (Date.now() - at < 8000) {
      const text = await safeFile(reply, 1024);
      if (text) {
        const data = JSON.parse(text);
        const latest = await safeFile(policy, 65536);
        return (
          data.nonce === nonce &&
          data.digest === digest &&
          data.ready === true &&
          data.at >= at &&
          data.at <= Date.now() &&
          Date.now() - data.at <= 10000 &&
          latest !== null &&
          createHash('sha256').update(latest).digest('hex') === digest
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  } finally {
    await Promise.all([unlink(request).catch(() => {}), unlink(reply).catch(() => {})]);
  }
}

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;
  try {
    const { configRoot, dir, policyText } = await control();
    const status = (await readStatus(dir)) ?? (await queuedRequest(dir));
    // Docker bind mounts hide the host symlink. Use the host's pinned identity.
    const roots = JSON.parse(policyText).roots as { path: string; realPath: string }[];
    const physicalDestination = roots.find((root) => root.path === configRoot)?.realPath ?? configRoot;
    return response({ available: true, configRoot, physicalDestination, status });
  } catch (error) {
    return response(
      { available: false, error: error instanceof Error ? error.message : 'Storage move unavailable', setup },
      503
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;
  const length = Number(request.headers.get('content-length'));
  if (length > 2048) return response({ error: 'Request is too large' }, 413);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return response({ error: 'Request is too large' }, 413);
    body = JSON.parse(text);
  } catch {
    return response({ error: 'Invalid request' }, 400);
  }
  const input = body as { destination?: unknown; confirm?: unknown } | null;
  if (!input || !absolute(input.destination) || input.confirm !== true)
    return response(
      { error: 'An absolute destination and explicit downtime/copy/retain-original confirmation are required' },
      400
    );
  try {
    const { configRoot, dir, bridge, policy, policyText } = await control();
    const destination = input.destination;
    const physical = await realpath(configRoot);
    const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`);
    if (
      overlaps(destination, configRoot) ||
      overlaps(configRoot, destination) ||
      overlaps(destination, physical) ||
      overlaps(physical, destination)
    )
      return response({ error: 'Destination cannot overlap the current configuration' }, 400);
    const status = await readStatus(dir);
    // The host worker deliberately requires review even after completion or failure.
    if (status || (await safeFile(path.join(dir, 'request.json'))) || (await safeFile(path.join(dir, 'active.json'))))
      return response(
        { error: 'Previous configuration move requires host review before another request', status },
        409
      );
    if (!(await hostReady(bridge, policy, policyText)))
      return response({ error: 'Host storage monitor is not responding', setup }, 503);
    await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const moveDir = await lstat(dir);
    if (!moveDir.isDirectory() || moveDir.isSymbolicLink()) throw new Error('Invalid storage move directory');
    const queued = { version: 1, id: randomUUID(), destination, requestedAt: new Date().toISOString() };
    const target = path.join(dir, 'request.json');
    const tmp = path.join(dir, `.${queued.id}.tmp`);
    const handle = await open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(queued));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // Atomic, exclusive publication: a second process cannot replace an outstanding request.
      await link(tmp, target);
    } finally {
      await unlink(tmp).catch(() => {});
    }
    return response({ status: { id: queued.id, phase: 'queued', destination, updatedAt: queued.requestedAt } }, 202);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return response({ error: 'A configuration move request already exists' }, 409);
    return response({ error: error instanceof Error ? error.message : 'Storage move unavailable', setup }, 503);
  }
}
