import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type CapacityStatus =
  | 'available'
  | 'not-enrolled'
  | 'missing'
  | 'unmounted'
  | 'stale-identity'
  | 'permission-denied'
  | 'probe-unavailable'
  | 'guard-unavailable'
  | 'invalid-proof';
export type HostUsage = {
  filesystem: string;
  mountPoint: string;
  totalKilobytes: number;
  availableKilobytes: number;
  usedPercent: number;
  volumeId?: string;
  realPath?: string;
  requestedPath?: string;
};
export type HostCapacity = { status: CapacityStatus; usage: HostUsage | null };
const statuses: CapacityStatus[] = [
  'not-enrolled',
  'missing',
  'unmounted',
  'stale-identity',
  'permission-denied',
  'probe-unavailable',
  'guard-unavailable',
  'invalid-proof'
];
type RecordRoot = { path: string; realPath: string; mountPoint: string; uuid: string };
const within = (child: string, parent: string) => child === parent || child.startsWith(`${parent.replace(/\/$/, '')}/`);

// The host-owned allowlist is not widened by discovery. New reporting-only roots
// require explicit observation enrollment, independent of lifecycle protection.
export function readHostCapacity(diskPath: string, policyFile: string, timeout = 3500): HostCapacity {
  let request = '';
  let response = '';
  const fail = (status: CapacityStatus): HostCapacity => ({ status, usage: null });
  try {
    const text = fs.readFileSync(policyFile, 'utf8');
    const policy = JSON.parse(text) as { roots?: RecordRoot[]; observations?: RecordRoot[] };
    const state = path.dirname(policyFile);
    const root = [...(policy.roots ?? []), ...(policy.observations ?? [])]
      .filter((entry) => typeof entry.path === 'string' && within(diskPath, entry.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (
      !path.isAbsolute(diskPath) ||
      /[\0\r\n]/.test(diskPath) ||
      diskPath.split('/').some((part) => part === '.' || part === '..')
    )
      return fail('not-enrolled');
    if (!root && !within(diskPath, state)) return fail('not-enrolled');
    const bridge = path.join(state, 'storage-bridge');
    const bridgeStat = fs.lstatSync(bridge);
    if (!bridgeStat.isDirectory() || bridgeStat.isSymbolicLink()) return fail('probe-unavailable');
    const nonce = randomBytes(16).toString('hex');
    const digest = createHash('sha256').update(text).digest('hex');
    const at = Date.now();
    request = path.join(bridge, `${nonce}.request`);
    response = path.join(bridge, `${nonce}.response`);
    fs.writeFileSync(request, JSON.stringify({ nonce, digest, at, operation: 'usage', path: diskPath }), {
      flag: 'wx',
      mode: 0o600
    });
    while (Date.now() - at < timeout) {
      if (fs.existsSync(response)) {
        const stat = fs.lstatSync(response);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return fail('invalid-proof');
        const reply = JSON.parse(fs.readFileSync(response, 'utf8')) as {
          nonce: string;
          digest: string;
          ready: boolean;
          at: number;
          usage?: HostUsage;
          status?: CapacityStatus;
        };
        if (
          reply.nonce !== nonce ||
          reply.digest !== digest ||
          createHash('sha256').update(fs.readFileSync(policyFile)).digest('hex') !== digest ||
          !Number.isFinite(reply.at) ||
          reply.at < at ||
          reply.at > Date.now() ||
          Date.now() - reply.at > 10000
        )
          return fail('invalid-proof');
        if (!reply.ready) return fail(statuses.includes(reply.status!) ? reply.status! : 'probe-unavailable');
        const v = reply.usage;
        if (
          !v ||
          typeof v.filesystem !== 'string' ||
          !v.filesystem ||
          typeof v.mountPoint !== 'string' ||
          !path.isAbsolute(v.mountPoint) ||
          (root && v.mountPoint !== root.mountPoint) ||
          (v.volumeId !== undefined && root && v.volumeId !== root.uuid) ||
          // Exact request binding is required for descendant proof. Old responders
          // can still answer an exact enrollment, never a substituted ancestor.
          (v.requestedPath !== undefined && v.requestedPath !== diskPath) ||
          (diskPath !== (root?.path ?? state) && v.requestedPath !== diskPath) ||
          (v.realPath !== undefined && root && !within(v.realPath, root.realPath)) ||
          (root && diskPath === root.path && v.realPath !== undefined && v.realPath !== root.realPath) ||
          !Number.isSafeInteger(v.totalKilobytes) ||
          v.totalKilobytes <= 0 ||
          !Number.isSafeInteger(v.availableKilobytes) ||
          v.availableKilobytes < 0 ||
          v.availableKilobytes > v.totalKilobytes ||
          !Number.isInteger(v.usedPercent) ||
          v.usedPercent < 0 ||
          v.usedPercent > 100
        )
          return fail('invalid-proof');
        // Older responders already validate the complete policy identity. Optional
        // response identity fields strengthen new responders without breaking them.
        return {
          status: 'available',
          usage: { ...v, ...(root ? { volumeId: root.uuid } : {}) }
        };
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return fail(code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'probe-unavailable');
  } finally {
    for (const file of [request, response])
      if (file) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          /* Cleanup must not fabricate capacity. */
        }
      }
  }
  return fail('probe-unavailable');
}
