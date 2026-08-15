import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { promisify } from 'node:util';
import { repoRoot } from '../paths';
import { type DangerousConfirmation, requireDangerousConfirmation } from '../safety/dangerous';
import { getServices } from '../services';

const execFileAsync = promisify(execFile);
const dockerTimeoutMs = 30_000;
const maxBuffer = 8 * 1024 * 1024;

type DockerContainerRow = {
  ID?: string;
  Image?: string;
  Names?: string;
  Ports?: string;
  State?: string;
  Status?: string;
  RunningFor?: string;
  Size?: string;
};

type DockerStatsResponse = {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    online_cpus?: number;
    system_cpu_usage?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: { inactive_file?: number; total_inactive_file?: number };
  };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
  blkio_stats?: {
    io_service_bytes_recursive?: Array<{ op?: string; value?: number }>;
  };
  pids_stats?: { current?: number };
};

type DockerImageRow = {
  ID?: string;
  Repository?: string;
  Tag?: string;
  Digest?: string;
  CreatedSince?: string;
  Size?: string;
};

type DockerVolumeRow = {
  Driver?: string;
  Labels?: string;
  Name?: string;
  Scope?: string;
  Size?: string;
};

type DockerNetworkRow = {
  Driver?: string;
  ID?: string;
  IPv6?: string;
  Internal?: string;
  Labels?: string;
  Name?: string;
  Scope?: string;
};

type ContainerInspect = {
  Id?: string;
  Image?: string;
  Name?: string;
  Created?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
    Running?: boolean;
    StartedAt?: string;
    FinishedAt?: string;
  };
  HostConfig?: {
    RestartPolicy?: {
      Name?: string;
    };
  };
  Mounts?: Array<{
    Type?: string;
    Name?: string;
    Source?: string;
    Destination?: string;
    Driver?: string;
    RW?: boolean;
  }>;
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    Networks?: Record<string, { IPAddress?: string; NetworkID?: string }>;
  };
};

type VolumeInspect = {
  Name?: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Scope?: string;
  Labels?: Record<string, string>;
  Options?: Record<string, string>;
  UsageData?: {
    Size?: number;
    RefCount?: number;
  };
};

type NetworkInspect = {
  Id?: string;
  Name?: string;
  Created?: string;
  Driver?: string;
  Scope?: string;
  Internal?: boolean;
  Attachable?: boolean;
  Ingress?: boolean;
  IPAM?: {
    Config?: Array<{ Subnet?: string; Gateway?: string }>;
  };
  Labels?: Record<string, string>;
  Containers?: Record<string, { Name?: string; IPv4Address?: string; IPv6Address?: string }>;
};

type ContainerSnapshot = {
  rows: DockerContainerRow[];
  inspected: ContainerInspect[];
  inspectById: Map<string, ContainerInspect>;
};

export type ContainerMount = {
  type: string;
  name?: string;
  source?: string;
  destination?: string;
  writable?: boolean;
};

export type ContainerPort = {
  container: string;
  hostIp?: string;
  hostPort?: string;
  localUrl?: string;
};

export type DockerContainerItem = {
  id: string;
  shortId: string;
  name: string;
  displayName: string;
  kind: 'container';
  image: string;
  state: string;
  running: boolean;
  status: string;
  runningFor?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  restartPolicy?: string;
  ports: ContainerPort[];
  localUrls: string[];
  mounts: ContainerMount[];
  networks: string[];
  labels: Record<string, string>;
  composeProject?: string;
  composeService?: string;
  stackarrManaged: boolean;
  stats?: {
    cpu: string;
    memory: string;
    memoryPercent: string;
    network: string;
    disk: string;
    pids?: string;
    cpuPercent: number;
    memoryBytes: number;
    memoryLimitBytes: number;
    networkRxBytes: number;
    networkTxBytes: number;
    blockReadBytes: number;
    blockWriteBytes: number;
  };
  removable: boolean;
};

export type DockerVolumeItem = {
  name: string;
  driver?: string;
  scope?: string;
  size?: string;
  sizeBytes?: number;
  createdAt?: string;
  mountpoint?: string;
  labels: Record<string, string>;
  usedBy: string[];
  inUse: boolean;
  dangling: boolean;
  removable: boolean;
};

export type DockerImageItem = {
  id: string;
  shortId: string;
  repository: string;
  tag: string;
  digest?: string;
  reference: string;
  createdSince?: string;
  size?: string;
  inUse: boolean;
  usedBy: string[];
  dangling: boolean;
  removable: boolean;
};

export type DockerNetworkItem = {
  id: string;
  shortId: string;
  name: string;
  driver?: string;
  scope?: string;
  internal: boolean;
  attachable: boolean;
  createdAt?: string;
  subnets: string[];
  labels: Record<string, string>;
  usedBy: string[];
  inUse: boolean;
  system: boolean;
  removable: boolean;
};

export type DockerOverview = {
  dockerAvailable: boolean;
  error?: string;
  generatedAt: string;
  counts: {
    containers: number;
    runningContainers: number;
    stoppedContainers: number;
    volumes: number;
    unusedVolumes: number;
    images: number;
    unusedImages: number;
    danglingImages: number;
    networks: number;
    unusedNetworks: number;
  };
  containers: DockerContainerItem[];
  volumes: DockerVolumeItem[];
  images: DockerImageItem[];
  networks: DockerNetworkItem[];
};

export type DockerContainerOverview = Pick<DockerOverview, 'dockerAvailable' | 'error' | 'generatedAt'> & {
  containers: DockerContainerItem[];
  counts: Pick<DockerOverview['counts'], 'containers' | 'runningContainers' | 'stoppedContainers'>;
};

export type DockerResourceActionInput = DangerousConfirmation & {
  kind: 'container' | 'volume' | 'image' | 'network';
  action: 'start' | 'stop' | 'restart' | 'remove' | 'pruneExited' | 'pruneDangling' | 'pruneUnused';
  id?: string;
  force?: boolean;
  deleteVolumes?: boolean;
};

export async function getDockerOverviewAction(): Promise<DockerOverview> {
  try {
    const snapshot = await containerSnapshot();
    const [containers, volumes, images, networks] = await Promise.all([
      listContainers(snapshot),
      listVolumes(snapshot),
      listImages(snapshot),
      listNetworks()
    ]);

    return {
      dockerAvailable: true,
      generatedAt: new Date().toISOString(),
      counts: {
        containers: containers.length,
        runningContainers: containers.filter((item) => item.running).length,
        stoppedContainers: containers.filter((item) => !item.running).length,
        volumes: volumes.length,
        unusedVolumes: volumes.filter((item) => !item.inUse).length,
        images: images.length,
        unusedImages: images.filter((item) => !item.inUse && !item.dangling).length,
        danglingImages: images.filter((item) => item.dangling).length,
        networks: networks.length,
        unusedNetworks: networks.filter((item) => !item.inUse && !item.system).length
      },
      containers,
      volumes,
      images,
      networks
    };
  } catch (error) {
    return {
      dockerAvailable: false,
      error: errorMessage(error),
      generatedAt: new Date().toISOString(),
      counts: {
        containers: 0,
        runningContainers: 0,
        stoppedContainers: 0,
        volumes: 0,
        unusedVolumes: 0,
        images: 0,
        unusedImages: 0,
        danglingImages: 0,
        networks: 0,
        unusedNetworks: 0
      },
      containers: [],
      volumes: [],
      images: [],
      networks: []
    };
  }
}

export async function getDockerContainerOverviewAction(): Promise<DockerContainerOverview> {
  try {
    const containers = await listContainers(await containerSnapshot());
    return {
      dockerAvailable: true,
      generatedAt: new Date().toISOString(),
      counts: {
        containers: containers.length,
        runningContainers: containers.filter((item) => item.running).length,
        stoppedContainers: containers.filter((item) => !item.running).length
      },
      containers
    };
  } catch (error) {
    return {
      dockerAvailable: false,
      error: errorMessage(error),
      generatedAt: new Date().toISOString(),
      counts: { containers: 0, runningContainers: 0, stoppedContainers: 0 },
      containers: []
    };
  }
}

export async function manageDockerResourceAction(input: DockerResourceActionInput) {
  if (input.kind === 'volume' && input.action === 'pruneUnused') {
    throw new Error(
      'Bulk volume pruning is disabled. Remove each reviewed volume by exact name so confirmation cannot affect unrelated data.'
    );
  }

  const needsConfirmation =
    input.action === 'remove' ||
    input.action === 'pruneExited' ||
    input.action === 'pruneDangling' ||
    input.action === 'pruneUnused' ||
    input.action === 'stop' ||
    input.action === 'restart' ||
    input.deleteVolumes === true;

  if (needsConfirmation) {
    requireDangerousConfirmation(input);
  }

  const args = dockerActionArgs(input);
  const { stdout, stderr } = await docker(args);

  return {
    accepted: true,
    kind: input.kind,
    action: input.action,
    target: input.id,
    stdout,
    stderr
  };
}

async function listContainers(snapshot: ContainerSnapshot): Promise<DockerContainerItem[]> {
  const statsById = await containerStats(snapshot);
  const serviceNames = new Set(getServices().map((service) => service.name));

  return snapshot.rows
    .map((row) => {
      const id = row.ID ?? '';
      const inspected = snapshot.inspectById.get(shortId(id));
      const name = trimContainerName(inspected?.Name) || row.Names || shortId(id);
      const labels = inspected?.Config?.Labels ?? {};
      const ports = portsFromInspect(inspected);
      const running = Boolean(inspected?.State?.Running) || row.State === 'running';
      const stats = statsById.get(shortId(inspected?.Id ?? id));
      const composeProject = labels['com.docker.compose.project'];
      const composeService = labels['com.docker.compose.service'];
      const displayName = displayContainerName(name, composeProject, composeService);

      return {
        id: inspected?.Id ?? id,
        shortId: shortId(inspected?.Id ?? id),
        name,
        displayName,
        kind: 'container' as const,
        image: inspected?.Config?.Image ?? row.Image ?? '',
        state: inspected?.State?.Status ?? row.State ?? 'unknown',
        running,
        status: row.Status ?? inspected?.State?.Status ?? 'unknown',
        runningFor: row.RunningFor,
        createdAt: inspected?.Created,
        startedAt: inspected?.State?.StartedAt,
        finishedAt: inspected?.State?.FinishedAt,
        restartPolicy: inspected?.HostConfig?.RestartPolicy?.Name,
        ports,
        localUrls: unique(ports.map((port) => port.localUrl).filter(Boolean) as string[]),
        mounts: (inspected?.Mounts ?? []).map((mount) => ({
          type: mount.Type ?? '',
          name: mount.Name,
          source: mount.Source,
          destination: mount.Destination,
          writable: mount.RW
        })),
        networks: Object.keys(inspected?.NetworkSettings?.Networks ?? {}),
        labels,
        composeProject,
        composeService,
        stackarrManaged:
          composeProject === 'stackarr' ||
          serviceNames.has(name) ||
          Boolean(composeService && serviceNames.has(composeService)),
        stats,
        removable: !running
      };
    })
    .sort(
      (a, b) =>
        serviceRank(a.displayName) - serviceRank(b.displayName) ||
        Number(b.stackarrManaged) - Number(a.stackarrManaged) ||
        a.displayName.localeCompare(b.displayName)
    );
}

async function containerStats(snapshot: ContainerSnapshot) {
  const runningIds = snapshot.inspected
    .filter((item) => item.State?.Running && item.Id)
    .map((item) => item.Id as string);
  const samples = await Promise.allSettled(
    runningIds.map(async (id) => ({
      id,
      sample: await dockerEngineJson<DockerStatsResponse>(
        `/v1.41/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`
      )
    }))
  );
  const result = new Map<string, NonNullable<DockerContainerItem['stats']>>();

  for (const settled of samples) {
    if (settled.status !== 'fulfilled') continue;
    result.set(shortId(settled.value.id), summarizeStats(settled.value.sample));
  }

  return result;
}

function summarizeStats(sample: DockerStatsResponse): NonNullable<DockerContainerItem['stats']> {
  const cpuTotal = sample.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const previousCpuTotal = sample.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const systemTotal = sample.cpu_stats?.system_cpu_usage ?? 0;
  const previousSystemTotal = sample.precpu_stats?.system_cpu_usage ?? 0;
  const cpuDelta = cpuTotal - previousCpuTotal;
  const systemDelta = systemTotal - previousSystemTotal;
  const cpuCount = sample.cpu_stats?.online_cpus ?? sample.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
  const cpuPercent = cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  const memoryUsage = sample.memory_stats?.usage ?? 0;
  const memoryCache = sample.memory_stats?.stats?.total_inactive_file ?? sample.memory_stats?.stats?.inactive_file ?? 0;
  const memoryBytes = Math.max(0, memoryUsage - memoryCache);
  const memoryLimitBytes = sample.memory_stats?.limit ?? 0;
  const memoryPercent = memoryLimitBytes > 0 ? (memoryBytes / memoryLimitBytes) * 100 : 0;

  const network = Object.values(sample.networks ?? {}).reduce(
    (total, item) => ({
      rx: total.rx + (item.rx_bytes ?? 0),
      tx: total.tx + (item.tx_bytes ?? 0)
    }),
    { rx: 0, tx: 0 }
  );
  const block = (sample.blkio_stats?.io_service_bytes_recursive ?? []).reduce(
    (total, item) => {
      const operation = item.op?.toLowerCase();
      if (operation === 'read') total.read += item.value ?? 0;
      if (operation === 'write') total.write += item.value ?? 0;
      return total;
    },
    { read: 0, write: 0 }
  );

  return {
    cpu: `${formatDockerNumber(cpuPercent)}%`,
    memory: `${formatDockerBytes(memoryBytes)} / ${formatDockerBytes(memoryLimitBytes)}`,
    memoryPercent: `${formatDockerNumber(memoryPercent)}%`,
    network: `${formatDockerBytes(network.rx)} / ${formatDockerBytes(network.tx)}`,
    disk: `${formatDockerBytes(block.read)} / ${formatDockerBytes(block.write)}`,
    pids: String(sample.pids_stats?.current ?? 0),
    cpuPercent,
    memoryBytes,
    memoryLimitBytes,
    networkRxBytes: network.rx,
    networkTxBytes: network.tx,
    blockReadBytes: block.read,
    blockWriteBytes: block.write
  };
}

function dockerEngineJson<T>(path: string): Promise<T> {
  const socketPath = dockerSocketPath();

  return new Promise((resolve, reject) => {
    const request = httpRequest({ socketPath, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Docker Engine returned HTTP ${response.statusCode ?? 'unknown'}.`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error('Docker Engine metrics request timed out.')));
    request.on('error', reject);
    request.end();
  });
}

function dockerSocketPath() {
  const configured = process.env.DOCKER_HOST?.trim();
  return configured?.startsWith('unix://') ? configured.slice('unix://'.length) : '/var/run/docker.sock';
}

function formatDockerNumber(value: number) {
  return value < 10 ? value.toFixed(2) : value.toFixed(1);
}

function formatDockerBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unit;
  return `${scaled < 10 && unit > 0 ? scaled.toFixed(2) : scaled.toFixed(1)} ${units[unit]}`;
}

async function listVolumes(snapshot: ContainerSnapshot): Promise<DockerVolumeItem[]> {
  const rows = parseJsonLines<DockerVolumeRow>((await docker(['volume', 'ls', '--format', '{{json .}}'])).stdout);
  const inspected = byKey(
    await inspect<VolumeInspect>(rows.map((row) => row.Name).filter(Boolean) as string[], 'volume'),
    (item) => item.Name ?? ''
  );
  const usedBy = volumeUsage(snapshot.inspected);

  return rows
    .map((row) => {
      const name = row.Name ?? '';
      const details = inspected.get(name);
      const users = usedBy.get(name) ?? [];
      const inUse = users.length > 0 || Boolean(details?.UsageData?.RefCount && details.UsageData.RefCount > 0);

      return {
        name,
        driver: details?.Driver ?? row.Driver,
        scope: details?.Scope ?? row.Scope,
        size: row.Size,
        sizeBytes: details?.UsageData?.Size,
        createdAt: details?.CreatedAt,
        mountpoint: details?.Mountpoint,
        labels: details?.Labels ?? parseLabels(row.Labels),
        usedBy: users,
        inUse,
        dangling: !inUse,
        removable: !inUse
      };
    })
    .sort((a, b) => Number(a.inUse) - Number(b.inUse) || a.name.localeCompare(b.name));
}

async function listImages(snapshot: ContainerSnapshot): Promise<DockerImageItem[]> {
  const rows = parseJsonLines<DockerImageRow>(
    (await docker(['image', 'ls', '-a', '--digests', '--format', '{{json .}}'])).stdout
  );
  const containers = containersForImageUsage(snapshot);

  return rows
    .map((row) => {
      const repository = row.Repository ?? '';
      const tag = row.Tag ?? '';
      const id = row.ID ?? '';
      const untagged = repository === '<none>' || tag === '<none>';
      const reference = untagged ? id : `${repository}:${tag}`;
      const usedBy = containers
        .filter((container) => imageMatches(container.image, { id, reference, repository, tag }, container.imageId))
        .map((container) => container.name);
      const inUse = usedBy.length > 0;
      const dangling = untagged && !inUse;

      return {
        id,
        shortId: shortId(id),
        repository,
        tag,
        digest: row.Digest,
        reference,
        createdSince: row.CreatedSince,
        size: row.Size,
        inUse,
        usedBy,
        dangling,
        removable: !inUse
      };
    })
    .sort((a, b) => imageGroupRank(a) - imageGroupRank(b) || a.reference.localeCompare(b.reference));
}

async function listNetworks(): Promise<DockerNetworkItem[]> {
  const rows = parseJsonLines<DockerNetworkRow>((await docker(['network', 'ls', '--format', '{{json .}}'])).stdout);
  const inspected = byKey(
    await inspect<NetworkInspect>(rows.map((row) => row.ID).filter(Boolean) as string[], 'network'),
    (item) => shortId(item.Id ?? '')
  );

  return rows
    .map((row) => {
      const id = row.ID ?? '';
      const details = inspected.get(shortId(id));
      const name = details?.Name ?? row.Name ?? shortId(id);
      const usedBy = Object.values(details?.Containers ?? {})
        .map((container) => container.Name)
        .filter(Boolean) as string[];
      const system = ['bridge', 'host', 'none'].includes(name);

      return {
        id: details?.Id ?? id,
        shortId: shortId(details?.Id ?? id),
        name,
        driver: details?.Driver ?? row.Driver,
        scope: details?.Scope ?? row.Scope,
        internal: Boolean(details?.Internal) || row.Internal === 'true',
        attachable: Boolean(details?.Attachable),
        createdAt: details?.Created,
        subnets: (details?.IPAM?.Config ?? []).map((item) => item.Subnet).filter(Boolean) as string[],
        labels: details?.Labels ?? parseLabels(row.Labels),
        usedBy,
        inUse: usedBy.length > 0,
        system,
        removable: !system && usedBy.length === 0
      };
    })
    .sort(
      (a, b) => Number(a.system) - Number(b.system) || Number(a.inUse) - Number(b.inUse) || a.name.localeCompare(b.name)
    );
}

function containersForImageUsage(snapshot: ContainerSnapshot) {
  return snapshot.rows.map((row) => {
    const details = snapshot.inspectById.get(shortId(row.ID ?? ''));
    const name = trimContainerName(details?.Name) || row.Names || shortId(row.ID ?? '');
    const labels = details?.Config?.Labels ?? {};

    return {
      name: displayContainerName(name, labels['com.docker.compose.project'], labels['com.docker.compose.service']),
      image: row.Image ?? '',
      imageId: details?.Image ?? ''
    };
  });
}

function volumeUsage(inspected: ContainerInspect[]) {
  const usage = new Map<string, string[]>();

  for (const container of inspected) {
    const labels = container.Config?.Labels ?? {};
    const rawName = trimContainerName(container.Name) || shortId(container.Id ?? '');
    const name = displayContainerName(
      rawName,
      labels['com.docker.compose.project'],
      labels['com.docker.compose.service']
    );
    for (const mount of container.Mounts ?? []) {
      if (mount.Type !== 'volume' || !mount.Name) {
        continue;
      }

      const current = usage.get(mount.Name) ?? [];
      current.push(name);
      usage.set(mount.Name, current);
    }
  }

  return usage;
}

async function containerSnapshot(): Promise<ContainerSnapshot> {
  const rows = parseJsonLines<DockerContainerRow>((await docker(['ps', '-a', '--format', '{{json .}}'])).stdout);
  const inspected = await inspect<ContainerInspect>(rows.map((row) => row.ID).filter(Boolean) as string[]);
  return {
    rows,
    inspected,
    inspectById: byKey(inspected, (item) => shortId(item.Id ?? ''))
  };
}

async function inspect<T>(ids: string[], kind?: 'volume' | 'network'): Promise<T[]> {
  if (ids.length === 0) {
    return [];
  }

  const args = kind ? [kind, 'inspect', ...ids] : ['inspect', ...ids];
  const result = await dockerAllowFail(args);
  if (!result.stdout.trim()) {
    return [];
  }

  try {
    return JSON.parse(result.stdout) as T[];
  } catch {
    return [];
  }
}

function portsFromInspect(container?: ContainerInspect): ContainerPort[] {
  const ports = container?.NetworkSettings?.Ports ?? {};
  const result: ContainerPort[] = [];

  for (const [containerPort, bindings] of Object.entries(ports)) {
    for (const binding of bindings ?? []) {
      const hostPort = binding.HostPort;
      const hostIp = binding.HostIp;
      result.push({
        container: containerPort,
        hostIp,
        hostPort,
        localUrl: hostPort ? `http://127.0.0.1:${hostPort}` : undefined
      });
    }
  }

  return result;
}

function displayContainerName(name: string, composeProject?: string, composeService?: string) {
  if (composeProject === 'stackarr' && composeService) {
    return composeService;
  }

  return name.replace(/^stackarr-([a-z0-9_-]+)-\d+$/i, '$1').replace(/-\d+$/, '');
}

function serviceRank(name: string) {
  return name === 'stackarr' ? -1 : 0;
}

function dockerActionArgs(input: DockerResourceActionInput) {
  if (input.kind === 'container') {
    if (input.action === 'pruneExited') return ['container', 'prune', '-f'];
    requireId(input);
    if (input.action === 'start') return ['start', input.id as string];
    if (input.action === 'stop') return ['stop', input.id as string];
    if (input.action === 'restart') return ['restart', input.id as string];
    if (input.action === 'remove') {
      return ['rm', ...(input.force ? ['-f'] : []), ...(input.deleteVolumes ? ['-v'] : []), input.id as string];
    }
  }

  if (input.kind === 'image') {
    if (input.action === 'pruneDangling') return ['image', 'prune', '-f', '--filter', 'dangling=true'];
    if (input.action === 'pruneUnused') return ['image', 'prune', '-a', '-f'];
    requireId(input);
    if (input.action === 'remove') return ['rmi', ...(input.force ? ['-f'] : []), input.id as string];
  }

  if (input.kind === 'volume') {
    requireId(input);
    if (input.action === 'remove') return ['volume', 'rm', ...(input.force ? ['-f'] : []), input.id as string];
  }

  if (input.kind === 'network') {
    if (input.action === 'pruneUnused') return ['network', 'prune', '-f'];
    requireId(input);
    if (input.action === 'remove') return ['network', 'rm', input.id as string];
  }

  throw new Error(`Unsupported Docker resource action: ${input.kind}/${input.action}`);
}

function requireId(input: DockerResourceActionInput) {
  if (!input.id) {
    throw new Error(`Docker ${input.kind} action ${input.action} requires an id.`);
  }
}

async function docker(args: string[]) {
  return execFileAsync('docker', args, { cwd: repoRoot, timeout: dockerTimeoutMs, maxBuffer });
}

async function dockerAllowFail(args: string[]) {
  try {
    return await docker(args);
  } catch {
    return { stdout: '', stderr: '' };
  }
}

function parseJsonLines<T>(stdout: string): T[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

function parseLabels(value?: string) {
  if (!value) {
    return {};
  }

  return value.split(',').reduce<Record<string, string>>((labels, entry) => {
    const [key, ...rest] = entry.split('=');
    if (key) {
      labels[key] = rest.join('=');
    }
    return labels;
  }, {});
}

function byKey<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T>();

  for (const item of items) {
    const value = key(item);
    if (value) {
      map.set(value, item);
    }
  }

  return map;
}

function shortId(id: string) {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

function trimContainerName(name?: string) {
  return name?.replace(/^\//, '') ?? '';
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function imageGroupRank(image: DockerImageItem) {
  if (image.inUse) return 0;
  if (image.dangling) return 2;
  return 1;
}

function imageMatches(
  containerImage: string,
  image: { id: string; reference: string; repository: string; tag: string },
  containerImageId?: string
) {
  const normalizedContainerImageId = normalizeImageId(containerImageId);
  const normalizedImageId = normalizeImageId(image.id);

  if (!containerImage && !normalizedContainerImageId) {
    return false;
  }

  return (
    containerImage === image.reference ||
    containerImage === image.id ||
    normalizedContainerImageId === normalizedImageId ||
    shortId(normalizedContainerImageId) === shortId(normalizedImageId) ||
    shortId(normalizeImageId(containerImage)) === shortId(normalizedImageId) ||
    (!image.reference.includes('<none>') && containerImage.endsWith(`/${image.reference}`)) ||
    (image.tag === 'latest' && containerImage === image.repository)
  );
}

function normalizeImageId(value?: string) {
  return value?.replace(/^sha256:/, '') ?? '';
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
