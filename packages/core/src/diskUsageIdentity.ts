import type { DiskUsage } from './metrics';

// Browser-safe identity helpers. Never import runtime values from the server barrel.
// A measured host device plus mountpoint corroborates backing-volume identity.
// UUID alone is insufficient because clones retain it and state proofs omit it.
export function verifiedMountKey(disk: DiskUsage) {
  return disk.totalSpace !== null && disk.filesystem && disk.mountPoint
    ? JSON.stringify([disk.filesystem, disk.mountPoint])
    : null;
}

// Use the reconciled report identity in both consumers. Conflicting UUIDs or
// mount proofs stay separate; absent UUID metadata alone is not a conflict.
export function diskUsageKey(disk: DiskUsage) {
  const mount = verifiedMountKey(disk);
  if (mount) return JSON.stringify(['verified', disk.volumeId ?? null, mount]);
  return `unverified:${JSON.stringify([...disk.paths].sort())}`;
}
