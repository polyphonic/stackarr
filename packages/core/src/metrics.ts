import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diskUsageKey, verifiedMountKey } from './diskUsageIdentity';

export { diskUsageKey } from './diskUsageIdentity';

import { readEnv, type StackarrEnv } from './env';
import { type CapacityStatus, readHostCapacity } from './hostCapacity';
import { readHostCapacityReport } from './hostCapacityReport';
import { composePath, composeProjectDir, composeProjectName, repoRoot } from './paths';
import { discoverServiceStorage, type StorageAssociation, type StorageDiscovery } from './serviceStorage';
import { getServices } from './services';
import { readTasks } from './tasks';

type FilesystemUsage = {
  filesystem: string;
  type: string;
  totalKilobytes: number;
  availableKilobytes: number;
  usedPercent: number;
  mountPoint: string | null;
  reliable: boolean;
  volumeId?: string;
};

export type DiskUsage = StackMetrics['disks'][number];

export type StackMetrics = {
  generatedAt: string;
  serviceCounts: {
    total: number;
    configured: number;
    disabled: number;
    missing: number;
    dockerRunning: number | null;
  };
  performance: {
    cpuLoadPercent: number;
    loadAverage: number[];
    memoryUsedPercent: number;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    uptimeSeconds: number;
  };
  disks: Array<{
    label: string;
    path: string;
    paths: string[];
    filesystem: string | null;
    mountPoint: string | null;
    freeSpace: number | null;
    totalSpace: number | null;
    usedPercent: number | null;
    status?: CapacityStatus;
    volumeId?: string;
    associations?: Array<StorageAssociation & { status: CapacityStatus }>;
    discoveryIssues?: StorageDiscovery['issues'];
  }>;
  tasks: {
    queued: number;
    running: number;
    failed: number;
    completed: number;
  };
};

export function getStackMetrics(paths: string[] = [], disks?: StackMetrics['disks']): StackMetrics {
  const services = getServices();
  const tasks = readTasks();
  const memoryTotalBytes = os.totalmem();
  const memoryFreeBytes = os.freemem();
  const loadAverage = os.loadavg();
  const cpuCount = Math.max(os.cpus().length, 1);

  return {
    generatedAt: new Date().toISOString(),
    serviceCounts: {
      total: services.length,
      configured: services.filter((service) => service.status === 'configured').length,
      disabled: services.filter((service) => service.status === 'disabled').length,
      missing: services.filter((service) => service.status === 'missing').length,
      dockerRunning: readDockerRunningCount()
    },
    performance: {
      cpuLoadPercent: Math.min(100, Math.round((loadAverage[0] / cpuCount) * 100)),
      loadAverage,
      memoryUsedPercent: Math.round(((memoryTotalBytes - memoryFreeBytes) / memoryTotalBytes) * 100),
      memoryUsedBytes: memoryTotalBytes - memoryFreeBytes,
      memoryTotalBytes,
      uptimeSeconds: os.uptime()
    },
    disks: disks ?? diskUsages(paths),
    tasks: {
      queued: tasks.filter((task) => task.status === 'queued').length,
      running: tasks.filter((task) => task.status === 'running').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
      completed: tasks.filter((task) => task.status === 'completed').length
    }
  };
}

export async function getConfiguredStackMetrics() {
  return getStackMetrics([], await configuredDiskUsages(readEnv()));
}

function readDockerRunningCount() {
  try {
    const output = execFileSync(
      'docker',
      [
        'compose',
        '--project-name',
        composeProjectName,
        '--project-directory',
        composeProjectDir,
        '-f',
        composePath,
        'ps',
        '--status',
        'running',
        '--services'
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...readEnv() },
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );

    return output.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return null;
  }
}

export function diskUsages(paths: string[], probe: typeof diskUsage = diskUsage) {
  const requestedPaths = [...new Set(paths.filter(Boolean))];
  const fallbackPaths = requestedPaths.length > 0 ? requestedPaths : [readEnv().CONFIG_ROOT ?? repoRoot];
  // Probe the actual bound path, not its volume root: only a subdirectory may be shared with Docker.
  const disks = fallbackPaths.map((diskPath) => probe(diskPath));
  return groupDiskUsages(disks);
}

export function groupDiskUsages(disks: DiskUsage[]) {
  const byVolume = new Map<string, DiskUsage>();
  // State proofs may omit UUID while an observed path on the same host mount
  // supplies it. Resolve compatible metadata across the whole report first:
  // a UUID-less proof must never bridge two conflicting known identities.
  const identities = new Map<string, Set<string>>();
  for (const disk of disks) {
    const mount = verifiedMountKey(disk);
    if (mount && disk.volumeId) {
      const ids = identities.get(mount) ?? new Set<string>();
      ids.add(disk.volumeId);
      identities.set(mount, ids);
    }
  }

  for (const source of disks) {
    const mount = verifiedMountKey(source);
    const ids = mount ? identities.get(mount) : undefined;
    const disk = !source.volumeId && ids?.size === 1 ? { ...source, volumeId: [...ids][0] } : source;
    const key = diskUsageKey(disk);
    let current = byVolume.get(key);

    if (!current) {
      byVolume.set(key, disk);
      continue;
    }

    current.associations = [...(current.associations ?? []), ...(disk.associations ?? [])];
    current.paths = [...new Set([...current.paths, ...disk.paths])];
    // Preserve associations even when replacing a volume-level measurement.
    if (current.totalSpace === null && disk.totalSpace !== null) {
      current = {
        ...disk,
        associations: current.associations,
        paths: current.paths,
        path: current.path,
        label: current.label
      };
      byVolume.set(key, current);
    }
    current.path = preferredVolumeLabel(current.path, disk.path);
    current.label = volumeLabel(current.path);
  }

  return [...byVolume.values()].sort((a, b) => volumeRank(a) - volumeRank(b) || a.path.localeCompare(b.path));
}

// Keep agent and API disk reports on the same host-aware probe and configured roots.
export async function configuredDiskUsages(
  env: StackarrEnv,
  probe: typeof diskUsages = diskUsages,
  discover: (env: StackarrEnv) => Promise<StorageDiscovery> = discoverServiceStorage
) {
  const policyFile =
    process.env.STACKARR_STORAGE_POLICY ?? (env.STATE_ROOT && path.join(env.STATE_ROOT, 'storage-policy.json'));
  if (probe === diskUsages && discover === discoverServiceStorage && policyFile) {
    const report = await readHostCapacityReport(policyFile);
    if (report) {
      return groupDiskUsages(
        report.entries.map((entry) => {
          const v = entry.usage;
          const display = v?.mountPoint ?? externalVolumeRoot(entry.path) ?? entry.path;
          return {
            label: volumeLabel(display),
            path: display,
            paths: [entry.path],
            filesystem: v?.filesystem ?? null,
            mountPoint: v?.mountPoint ?? null,
            volumeId: v?.volumeId,
            freeSpace: v ? v.availableKilobytes * 1024 : null,
            totalSpace: v ? v.totalKilobytes * 1024 : null,
            usedPercent: v?.usedPercent ?? null,
            status: entry.status,
            associations: report.roots
              .filter((root) => root.path === entry.path)
              .map((root) => ({ ...root, status: entry.status })),
            discoveryIssues: report.issues
          };
        })
      );
    }
    // A new controller with a missing/old responder remains honest and bounded.
    // Never fall back to the old serialized bridge or guest/native df here.
    const discovered = await discover(env);
    return groupDiskUsages(
      [...new Set(discovered.roots.map((root) => root.path))].map((requested) => ({
        label: requested,
        path: requested,
        paths: [requested],
        filesystem: null,
        mountPoint: null,
        freeSpace: null,
        totalSpace: null,
        usedPercent: null,
        status: 'probe-unavailable' as const,
        associations: discovered.roots
          .filter((root) => root.path === requested)
          .map((root) => ({ ...root, status: 'probe-unavailable' as const })),
        discoveryIssues: [...discovered.issues, { service: 'host', status: 'capacity-report-unavailable' }]
      }))
    );
  }
  const { roots, issues } = await discover(env);
  // Attach exact-path outcomes before any grouping. A display label is not
  // evidence that two unavailable paths belong to the same backing volume.
  const disks = [...new Set(roots.map((root) => root.path))].flatMap((requested) =>
    probe([requested]).map((disk) => ({
      ...disk,
      associations: roots
        .filter((root) => root.path === requested)
        .map((root) => ({
          ...root,
          status: disk.status ?? (disk.totalSpace === null ? ('probe-unavailable' as const) : ('available' as const))
        })),
      discoveryIssues: issues
    }))
  );
  return groupDiskUsages(disks);
}

function diskUsage(diskPath: string): StackMetrics['disks'][number] {
  let status: CapacityStatus = 'probe-unavailable';
  try {
    const container =
      ['docker', 'docker-updater'].includes(process.env.STACKARR_RUNTIME ?? '') ||
      fs.existsSync('/.dockerenv') ||
      fs.existsSync('/run/.containerenv');
    const normalizedPath = container ? diskPath : fs.realpathSync(diskPath);
    let usage = container ? null : readFilesystemUsage(normalizedPath);
    if (container) {
      const env = readEnv();
      const policyFile =
        process.env.STACKARR_STORAGE_POLICY ?? (env.STATE_ROOT && path.join(env.STATE_ROOT, 'storage-policy.json'));
      if (policyFile) {
        const host = readHostCapacity(diskPath, policyFile);
        status = host.status;
        if (host.usage) usage = { ...host.usage, type: '', reliable: true };
      }
    }
    // Never report guest overlay or virtiofs capacity as a host disk measurement.
    if (usage && ['overlay', 'virtiofs', 'fuse.overlayfs', 'tmpfs'].includes(usage.type)) usage = null;
    if (
      usage &&
      !container &&
      externalVolumeRoot(normalizedPath) &&
      usage.mountPoint !== externalVolumeRoot(normalizedPath)
    ) {
      usage = null;
      status = 'unmounted';
    }
    if (!usage) throw new Error('Disk capacity unavailable');
    const freeSpace = usage.availableKilobytes * 1024;
    const totalSpace = usage.totalKilobytes * 1024;
    const mountPoint = usage.mountPoint;
    const displayPath = displayVolumePath(diskPath, normalizedPath, mountPoint);

    return {
      label: volumeLabel(displayPath),
      path: displayPath,
      paths: [diskPath],
      filesystem: `${usage.filesystem}${usage.type ? ` (${usage.type})` : ''}`,
      mountPoint,
      freeSpace,
      totalSpace,
      usedPercent: usage.usedPercent,
      status: 'available',
      ...(usage.volumeId ? { volumeId: usage.volumeId } : {})
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') status = 'missing';
    if (code === 'EACCES' || code === 'EPERM') status = 'permission-denied';
    const displayPath = externalVolumeRoot(diskPath) ?? diskPath;
    return {
      label: volumeLabel(displayPath),
      path: displayPath,
      paths: [diskPath],
      filesystem: null,
      mountPoint: null,
      freeSpace: null,
      totalSpace: null,
      usedPercent: null,
      status
    };
  }
}

function displayVolumePath(diskPath: string, normalizedPath: string, mountPoint: string | null) {
  const externalVolume =
    externalVolumeRoot(mountPoint ?? '') ?? externalVolumeRoot(diskPath) ?? externalVolumeRoot(normalizedPath);
  if (externalVolume) {
    return externalVolume;
  }

  return mountPoint ?? normalizedPath;
}

function externalVolumeRoot(pathValue: string) {
  const match = pathValue.match(/^\/Volumes\/[^/]+/);
  return match?.[0] ?? null;
}

function volumeLabel(pathLabel: string) {
  if (pathLabel === repoRoot || pathLabel === '/' || pathLabel === '/System/Volumes/Data') {
    return 'Macintosh HD';
  }

  return pathLabel;
}

function preferredVolumeLabel(current: string, next: string) {
  if (current === repoRoot || next === repoRoot) {
    return repoRoot;
  }

  if (current === '/') {
    return current;
  }

  if (next === '/') {
    return next;
  }

  return current.length <= next.length ? current : next;
}

function volumeRank(disk: { path: string; mountPoint: string | null }) {
  if (disk.path === repoRoot || disk.mountPoint === '/' || disk.mountPoint === '/System/Volumes/Data') {
    return 0;
  }

  return 1;
}

function readFilesystemUsage(diskPath: string): FilesystemUsage | null {
  const mac = process.platform === 'darwin';
  const output = execFileSync('df', mac ? ['-kP', diskPath] : ['-PTk', diskPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2500
  });
  return parseFilesystemUsage(output, false, mac);
}

export { resolveHostDiskPath } from './serviceStorage';

export function hostMountPoint(source: string, stateRoot = readEnv().STATE_ROOT): string {
  // Docker inspect retains a logical bind source even when the host follows a
  // symlink onto another disk. The host-owned storage policy records that
  // physical location; a container-side realpath of the bind cannot recover it.
  try {
    if (stateRoot) {
      const policy = JSON.parse(fs.readFileSync(path.join(stateRoot, 'storage-policy.json'), 'utf8')) as {
        roots?: Array<{ path: string; realPath: string; mountPoint: string }>;
      };
      const root = policy.roots
        ?.filter(
          (entry) =>
            typeof entry.path === 'string' &&
            typeof entry.realPath === 'string' &&
            typeof entry.mountPoint === 'string' &&
            (source === entry.path || source.startsWith(`${entry.path}/`))
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (root) {
        const physical = `${root.realPath}${source.slice(root.path.length)}`;
        if (physical === root.mountPoint || physical.startsWith(`${root.mountPoint}/`)) return root.mountPoint;
      }
    }
  } catch {
    // Older installs have no storage policy. Keep their original path behavior.
  }
  return externalVolumeRoot(source) ?? '/';
}

export function parseFilesystemUsage(output: string, reliable: boolean, mac = false): FilesystemUsage | null {
  const line = output.trim().split(/\r?\n/)[1];
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  const [filesystem, type, total, , available, capacity, ...mountParts] = mac
    ? [parts[0], '', ...parts.slice(1)]
    : parts;
  const totalKilobytes = Number(total);
  const availableKilobytes = Number(available);
  const usedPercent = Number.parseInt(capacity ?? '', 10);
  if (
    !filesystem ||
    !Number.isFinite(totalKilobytes) ||
    totalKilobytes <= 0 ||
    !Number.isFinite(availableKilobytes) ||
    availableKilobytes < 0 ||
    !Number.isFinite(usedPercent) ||
    !mountParts.length
  )
    return null;
  return {
    filesystem,
    type: type ?? '',
    totalKilobytes,
    availableKilobytes,
    usedPercent,
    mountPoint: mountParts.join(' ') || null,
    reliable: reliable || type !== 'virtiofs'
  };
}
