import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CapacityStatus, HostCapacity, HostUsage } from './hostCapacity';
import type { StorageAssociation, StorageDiscovery } from './serviceStorage';

export type EnclosingMount = {
  filesystem: string;
  filesystemType: string;
  mountPoint: string;
  volumeId: string;
  realAnchor: string;
  anchor: string;
};
export type CapacityReport = StorageDiscovery & {
  entries: Array<HostCapacity & { path: string; enclosingMount?: EnclosingMount }>;
};
const pending = new Map<string, Promise<CapacityReport | null>>();
const denied: CapacityStatus[] = [
  'not-enrolled',
  'missing',
  'unmounted',
  'stale-identity',
  'permission-denied',
  'probe-unavailable',
  'guard-unavailable',
  'invalid-proof'
];
const absolute = (v: unknown): v is string =>
  typeof v === 'string' &&
  path.isAbsolute(v) &&
  v.length <= 4096 &&
  !/[\0\r\n]/.test(v) &&
  !v.split('/').some((p) => p === '.' || p === '..');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export function validateCapacityReport(value: unknown): value is CapacityReport {
  if (!value || typeof value !== 'object') return false;
  const data = value as CapacityReport;
  if (
    !Array.isArray(data.roots) ||
    data.roots.length > 1024 ||
    !Array.isArray(data.issues) ||
    data.issues.length > 128 ||
    !Array.isArray(data.entries) ||
    data.entries.length > 128
  )
    return false;
  for (const root of data.roots) {
    if (
      !root ||
      !absolute(root.path) ||
      typeof root.service !== 'string' ||
      root.service.length > 100 ||
      typeof root.reason !== 'string' ||
      root.reason.length > 256 ||
      !['configuration', 'container-bind', 'native-library'].includes(root.source)
    )
      return false;
  }
  if (data.issues.some((v) => !v || typeof v.service !== 'string' || typeof v.status !== 'string')) return false;
  const paths = new Set(data.roots.map((r: StorageAssociation) => r.path));
  const seen = new Set<string>();
  for (const entry of data.entries) {
    if (!entry || !paths.has(entry.path) || seen.has(entry.path)) return false;
    seen.add(entry.path);
    if (entry.status !== 'available') {
      if (!denied.includes(entry.status) || entry.usage !== null) return false;
      const mount = entry.enclosingMount;
      if (
        mount &&
        (entry.status !== 'missing' ||
          !absolute(mount.mountPoint) ||
          !absolute(mount.anchor) ||
          !absolute(mount.realAnchor) ||
          typeof mount.volumeId !== 'string' ||
          !mount.volumeId ||
          typeof mount.filesystem !== 'string' ||
          !mount.filesystem ||
          typeof mount.filesystemType !== 'string' ||
          !mount.filesystemType ||
          !(
            mount.realAnchor === mount.mountPoint ||
            mount.realAnchor.startsWith(`${mount.mountPoint.replace(/\/$/, '')}/`)
          ) ||
          !(entry.path === mount.anchor || entry.path.startsWith(`${mount.anchor.replace(/\/$/, '')}/`)))
      )
        return false;
      continue;
    }
    const v: HostUsage | null = entry.usage;
    if (entry.enclosingMount) return false;
    if (
      !v ||
      v.requestedPath !== entry.path ||
      !absolute(v.realPath) ||
      !absolute(v.mountPoint) ||
      !(v.realPath === v.mountPoint || v.realPath.startsWith(`${v.mountPoint.replace(/\/$/, '')}/`)) ||
      typeof v.volumeId !== 'string' ||
      !v.volumeId ||
      typeof v.filesystem !== 'string' ||
      !v.filesystem ||
      ['overlay', 'virtiofs', 'tmpfs'].includes(v.filesystem) ||
      !Number.isSafeInteger(v.totalKilobytes) ||
      v.totalKilobytes <= 0 ||
      !Number.isSafeInteger(v.availableKilobytes) ||
      v.availableKilobytes < 0 ||
      v.availableKilobytes > v.totalKilobytes ||
      !Number.isInteger(v.usedPercent) ||
      v.usedPercent < 0 ||
      v.usedPercent > 100
    )
      return false;
  }
  return seen.size === paths.size;
}

export function readHostCapacityReport(policyFile: string, timeout = 8000): Promise<CapacityReport | null> {
  const existing = pending.get(policyFile);
  if (existing) return existing;
  const operation = readReport(policyFile, timeout).finally(() => pending.delete(policyFile));
  pending.set(policyFile, operation);
  return operation;
}
async function readReport(policyFile: string, timeout: number): Promise<CapacityReport | null> {
  let request = '',
    response = '';
  try {
    const hash = digest(await fs.readFile(policyFile, 'utf8'));
    const bridge = path.join(path.dirname(policyFile), 'storage-bridge');
    const directory = await fs.lstat(bridge);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return null;
    const nonce = randomBytes(16).toString('hex');
    const at = Date.now();
    request = path.join(bridge, `${nonce}.request`);
    response = path.join(bridge, `${nonce}.response`);
    await fs.writeFile(request, JSON.stringify({ nonce, digest: hash, at, operation: 'capacity-report' }), {
      flag: 'wx',
      mode: 0o600
    });
    while (Date.now() - at < timeout) {
      try {
        const stat = await fs.lstat(response);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) return null;
        const reply = JSON.parse(await fs.readFile(response, 'utf8'));
        if (
          reply.nonce !== nonce ||
          reply.digest !== hash ||
          reply.ready !== true ||
          !Number.isFinite(reply.at) ||
          reply.at < at ||
          reply.at > Date.now() ||
          Date.now() - reply.at > 10000 ||
          digest(await fs.readFile(policyFile, 'utf8')) !== hash ||
          !validateCapacityReport(reply)
        )
          return null;
        return { roots: reply.roots, issues: reply.issues, entries: reply.entries };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch {
    /* A missing or denied host proof never falls back to guest capacity. */
  } finally {
    await Promise.all([request, response].filter(Boolean).map((file) => fs.rm(file, { force: true }).catch(() => {})));
  }
  return null;
}
