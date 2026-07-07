import { execFile } from 'node:child_process';
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

type DockerStatsRow = {
  Container?: string;
  Name?: string;
  CPUPerc?: string;
  MemUsage?: string;
  MemPerc?: string;
  NetIO?: string;
  BlockIO?: string;
  PIDs?: string;
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

export type DockerResourceActionInput = DangerousConfirmation & {
  kind: 'container' | 'volume' | 'image' | 'network';
  action: 'start' | 'stop' | 'restart' | 'remove' | 'pruneExited' | 'pruneDangling' | 'pruneUnused';
  id?: string;
  force?: boolean;
  deleteVolumes?: boolean;
};

export async function getDockerOverviewAction(): Promise<DockerOverview> {
  try {
    await docker(['info', '--format', '{{json .ServerVersion}}']);

    const [containers, volumes, images, networks] = await Promise.all([
      listContainers(),
      listVolumes(),
      listImages(),
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

export async function manageDockerResourceAction(input: DockerResourceActionInput) {
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

async function listContainers(): Promise<DockerContainerItem[]> {
  const rows = parseJsonLines<DockerContainerRow>((await docker(['ps', '-a', '--format', '{{json .}}'])).stdout);
  const inspectById = byKey(
    await inspect<ContainerInspect>(rows.map((row) => row.ID).filter(Boolean) as string[]),
    (item) => shortId(item.Id ?? '')
  );
  const statsByName = byKey(
    parseJsonLines<DockerStatsRow>((await dockerAllowFail(['stats', '--no-stream', '--format', '{{json .}}'])).stdout),
    (item) => item.Name ?? ''
  );
  const serviceNames = new Set(getServices().map((service) => service.name));

  return rows
    .map((row) => {
      const id = row.ID ?? '';
      const inspected = inspectById.get(shortId(id));
      const name = trimContainerName(inspected?.Name) || row.Names || shortId(id);
      const labels = inspected?.Config?.Labels ?? {};
      const ports = portsFromInspect(inspected);
      const running = Boolean(inspected?.State?.Running) || row.State === 'running';
      const stats = statsByName.get(name);
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
        stats: stats
          ? {
              cpu: stats.CPUPerc ?? '',
              memory: stats.MemUsage ?? '',
              memoryPercent: stats.MemPerc ?? '',
              network: stats.NetIO ?? '',
              disk: stats.BlockIO ?? '',
              pids: stats.PIDs
            }
          : undefined,
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

async function listVolumes(): Promise<DockerVolumeItem[]> {
  const rows = parseJsonLines<DockerVolumeRow>((await docker(['volume', 'ls', '--format', '{{json .}}'])).stdout);
  const inspected = byKey(
    await inspect<VolumeInspect>(rows.map((row) => row.Name).filter(Boolean) as string[], 'volume'),
    (item) => item.Name ?? ''
  );
  const usedBy = await volumeUsage();

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

async function listImages(): Promise<DockerImageItem[]> {
  const rows = parseJsonLines<DockerImageRow>(
    (await docker(['image', 'ls', '-a', '--digests', '--format', '{{json .}}'])).stdout
  );
  const containers = await listContainersForImageUsage();

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

async function listContainersForImageUsage() {
  const rows = parseJsonLines<DockerContainerRow>(
    (await dockerAllowFail(['ps', '-a', '--format', '{{json .}}'])).stdout
  );
  const ids = rows.map((row) => row.ID).filter(Boolean) as string[];
  const inspected = byKey(await inspect<ContainerInspect>(ids), (item) => shortId(item.Id ?? ''));

  return rows.map((row) => {
    const details = inspected.get(shortId(row.ID ?? ''));
    const name = trimContainerName(details?.Name) || row.Names || shortId(row.ID ?? '');
    const labels = details?.Config?.Labels ?? {};

    return {
      name: displayContainerName(name, labels['com.docker.compose.project'], labels['com.docker.compose.service']),
      image: row.Image ?? '',
      imageId: details?.Image ?? ''
    };
  });
}

async function volumeUsage() {
  const rows = parseJsonLines<DockerContainerRow>(
    (await dockerAllowFail(['ps', '-a', '--format', '{{json .}}'])).stdout
  );
  const ids = rows.map((row) => row.ID).filter(Boolean) as string[];
  const inspected = await inspect<ContainerInspect>(ids);
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
    if (input.action === 'pruneUnused') return ['volume', 'prune', '-f'];
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
