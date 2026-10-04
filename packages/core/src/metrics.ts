import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { readEnv } from './env';
import { composePath, composeProjectDir, composeProjectName, repoRoot } from './paths';
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
};

const virtiofsUsageCache = new Map<string, { expiresAt: number; usage: FilesystemUsage | null }>();

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
  }>;
  tasks: {
    queued: number;
    running: number;
    failed: number;
    completed: number;
  };
};

export function getStackMetrics(paths: string[] = []): StackMetrics {
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
    disks: diskUsages(paths),
    tasks: {
      queued: tasks.filter((task) => task.status === 'queued').length,
      running: tasks.filter((task) => task.status === 'running').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
      completed: tasks.filter((task) => task.status === 'completed').length
    }
  };
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
  const byVolume = new Map<string, (typeof disks)[number]>();

  for (const disk of disks) {
    const key = volumeKey(disk);
    const current = byVolume.get(key);

    if (!current) {
      byVolume.set(key, disk);
      continue;
    }

    current.paths = [...new Set([...current.paths, ...disk.paths])];
    current.path = preferredVolumeLabel(current.path, disk.path);
    current.label = volumeLabel(current.path);
  }

  return [...byVolume.values()].sort((a, b) => volumeRank(a) - volumeRank(b) || a.path.localeCompare(b.path));
}

function diskUsage(diskPath: string) {
  try {
    const normalizedPath = fs.existsSync(diskPath) ? fs.realpathSync(diskPath) : diskPath;
    const containerUsage = readFilesystemUsage(diskPath);
    // Docker's shared virtiofs device reports another volume's capacity for unrelated binds.
    // Overlay is the VM, not the physical disk. Neither is a trustworthy fallback.
    const usage =
      process.platform === 'darwin'
        ? containerUsage
        : containerUsage?.type === 'virtiofs' ||
            containerUsage?.type === 'overlay' ||
            process.env.STACKARR_RUNTIME === 'docker'
          ? readVirtiofsHostUsage(diskPath)
          : containerUsage;
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
      usedPercent: usage.usedPercent
    };
  } catch {
    const displayPath = externalVolumeRoot(diskPath) ?? diskPath;
    return {
      label: volumeLabel(displayPath),
      path: displayPath,
      paths: [diskPath],
      filesystem: null,
      mountPoint: null,
      freeSpace: null,
      totalSpace: null,
      usedPercent: null
    };
  }
}

function volumeKey(disk: { path: string; filesystem: string | null; mountPoint: string | null }) {
  if (disk.path.startsWith('/Volumes/')) {
    return `host-volume:${disk.path}`;
  }

  if (disk.filesystem && disk.mountPoint) {
    return `${disk.filesystem}:${disk.mountPoint}`;
  }

  return `path:${disk.path}`;
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
  try {
    const mac = process.platform === 'darwin';
    const output = execFileSync('df', mac ? ['-kP', diskPath] : ['-PTk', diskPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500
    });
    return parseFilesystemUsage(output, false, mac);
  } catch {
    return null;
  }
}

// Resolve a container path against the running controller's actual bind mounts. Docker
// shares virtiofs devices, so df inside the app cannot identify the physical host disk.
export function resolveHostDiskPath(
  diskPath: string,
  mounts: Array<{ Type: string; Source: string; Destination: string }>
): string | null {
  const mount = mounts
    .filter(
      (item) => item.Type === 'bind' && (diskPath === item.Destination || diskPath.startsWith(`${item.Destination}/`))
    )
    .sort((a, b) => b.Destination.length - a.Destination.length)[0];
  if (mount) return `${mount.Source}${diskPath.slice(mount.Destination.length)}`;
  // Runtime config can contain host-side bind sources rather than container destinations.
  const hostBind = mounts
    .filter((item) => item.Type === 'bind' && (diskPath === item.Source || diskPath.startsWith(`${item.Source}/`)))
    .sort((a, b) => b.Source.length - a.Source.length)[0];
  if (hostBind) return diskPath;
  // OrbStack may expose the same absolute host path inside the container without an explicit bind.
  // Only trust this namespace for external volumes; never attribute arbitrary overlay paths to a host disk.
  return externalVolumeRoot(diskPath) ? diskPath : null;
}

function readVirtiofsHostUsage(diskPath: string): FilesystemUsage | null {
  const cached = virtiofsUsageCache.get(diskPath);
  if (cached && cached.expiresAt > Date.now()) return cached.usage;

  let usage: FilesystemUsage | null = null;
  try {
    const env = readEnv();
    const container = execFileSync(
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
        '-q',
        'app'
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim();
    if (!container) throw new Error('Controller container unavailable');
    const inspected = JSON.parse(
      execFileSync('docker', ['inspect', '--format', '{{json .}}', container], {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    ) as { Image?: string; Mounts?: Array<{ Type: string; Source: string; Destination: string }> };
    const source = resolveHostDiskPath(diskPath, inspected.Mounts ?? []);
    if (!source || !inspected.Image?.startsWith('sha256:')) throw new Error('Host path or running image unavailable');
    const output = execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--pull=never',
        '--network',
        'none',
        '--entrypoint',
        'df',
        '--mount',
        `type=bind,source=${source},target=/stackarr-storage-probe,readonly`,
        inspected.Image,
        '-PTk',
        '/stackarr-storage-probe'
      ],
      { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    usage = parseFilesystemUsage(output, true);
    // A failed bind must not become the VM overlay's capacity. The helper mountpoint
    // is synthetic; report the actual physical host volume instead.
    if (usage?.type === 'overlay') usage = null;
    if (usage) usage.mountPoint = externalVolumeRoot(source) ?? '/';
  } catch {
    usage = null;
  }

  // Transient Docker/image failures are retried on the next request, not cached as a false missing disk.
  if (usage) virtiofsUsageCache.set(diskPath, { expiresAt: Date.now() + 5 * 60 * 1000, usage });
  return usage;
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
