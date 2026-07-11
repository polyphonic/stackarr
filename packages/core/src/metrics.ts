import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { readEnv } from './env';
import { composePath, composeProjectDir, composeProjectName, repoRoot } from './paths';
import { getServices } from './services';
import { readTasks } from './tasks';

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

function diskUsages(paths: string[]) {
  const requestedPaths = paths.filter(Boolean);
  const fallbackPaths = requestedPaths.length > 0 ? requestedPaths : [repoRoot];
  const disks = fallbackPaths.map((diskPath) => diskUsage(diskPath));
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
    const usage = readFilesystemUsage(diskPath);
    if (!usage) throw new Error('Disk is not mounted');
    const freeSpace = usage.reliable ? usage.availableKilobytes * 1024 : null;
    const totalSpace = usage.reliable ? usage.totalKilobytes * 1024 : null;
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
      usedPercent: usage.reliable ? usage.usedPercent : null
    };
  } catch {
    return {
      label: diskPath,
      path: diskPath,
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
  if (diskPath === repoRoot || normalizedPath === repoRoot) {
    return repoRoot;
  }

  const externalVolume = externalVolumeRoot(diskPath) ?? externalVolumeRoot(normalizedPath);
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

function readFilesystemUsage(diskPath: string) {
  try {
    const output = execFileSync('df', ['-PTk', diskPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const line = output.trim().split(/\r?\n/)[1];
    if (!line) return null;
    const [filesystem, type, total, , available, capacity, ...mountParts] = line.trim().split(/\s+/);
    const totalKilobytes = Number(total);
    const availableKilobytes = Number(available);
    if (!filesystem || !Number.isFinite(totalKilobytes) || !Number.isFinite(availableKilobytes)) return null;
    return {
      filesystem,
      type,
      totalKilobytes,
      availableKilobytes,
      usedPercent: Number.parseInt(capacity ?? '', 10) || 0,
      mountPoint: mountParts.join(' ') || null,
      reliable: type !== 'virtiofs'
    };
  } catch {
    return null;
  }
}
