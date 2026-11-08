import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { requestJson } from './clients/http';
import { serviceApiKey, serviceBaseUrl } from './clients/serviceConfig';
import { readEnv, type StackarrEnv } from './env';
import { composeProjectName } from './paths';
import { serviceStorageFields } from './serviceCatalog';
import { getServices, type ServiceSummary, servicesFromEnv } from './services';

export type StorageAssociation = {
  path: string;
  service: string;
  reason: string;
  source: 'configuration' | 'container-bind' | 'native-library';
};
export type StorageService = Pick<ServiceSummary, 'name' | 'mode' | 'dockerService' | 'configPath'>;
export type StorageContainer = {
  Config?: { Labels?: Record<string, string> };
  State?: { Running: boolean };
  Mounts?: Array<{ Type: string; Source: string; Destination: string }>;
};
export type LibraryLocation = { service: string; path: string; reason: string };
export type StorageDiscovery = { roots: StorageAssociation[]; issues: Array<{ service: string; status: string }> };

function hostPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    path.isAbsolute(value) &&
    !/[\0\r\n]/.test(value) &&
    !value.split('/').some((part) => part === '..' || part === '.')
  );
}

const within = (child: string, parent: string) => child === parent || child.startsWith(`${parent.replace(/\/$/, '')}/`);

// Longest destination wins, including a named volume shadowing a parent bind.
export function resolveHostDiskPath(diskPath: string, mounts: NonNullable<StorageContainer['Mounts']>): string | null {
  const mount = mounts
    .filter((item) => within(diskPath, item.Destination))
    .sort((a, b) => b.Destination.length - a.Destination.length)[0];
  if (mount) return mount.Type === 'bind' ? path.join(mount.Source, path.relative(mount.Destination, diskPath)) : null;
  if (mounts.some((item) => item.Type === 'bind' && within(diskPath, item.Source))) return diskPath;
  return /^\/Volumes\/[^/]+/.test(diskPath) ? diskPath : null;
}

export function collectServiceStorage(input: {
  env: StackarrEnv;
  services: readonly StorageService[];
  containers: StorageContainer[];
  libraries: LibraryLocation[];
  project?: string;
  runtime?: string;
}): StorageAssociation[] {
  const { env, services, containers, libraries } = input;
  const roots: StorageAssociation[] = [];
  const enabled = services.filter((s) => s.mode !== 'disabled');
  const runtime = input.runtime ?? process.env.STACKARR_RUNTIME;
  const controllerNames = runtime === 'docker-updater' ? ['app-updater'] : ['stackarr', 'app'];
  const controllers = containers.filter(
    (container) =>
      container.Config?.Labels?.['com.docker.compose.project'] === (input.project ?? composeProjectName) &&
      controllerNames.includes(container.Config?.Labels?.['com.docker.compose.service'] ?? '') &&
      container.State?.Running !== false
  );
  // Do not borrow mounts from a stopped or ambiguous controller replacement.
  const controllerMounts =
    ['docker', 'docker-updater'].includes(runtime ?? '') && controllers.length === 1
      ? (controllers[0].Mounts ?? [])
      : [];
  const associated = new Set<string>();
  const add = (value: unknown, service: string, reason: string, source: StorageAssociation['source']) => {
    if (hostPath(value)) {
      const mapped =
        source === 'configuration' && controllerMounts.some((m) => within(value, m.Destination))
          ? resolveHostDiskPath(value, controllerMounts)
          : value;
      if (!hostPath(mapped)) return;
      const normalized = path.normalize(mapped);
      roots.push({ path: normalized, service, reason, source });
      associated.add(normalized);
    }
  };
  // Common roots describe Stackarr's own storage. Optional apps are not inferred from
  // the broad settings page, which also exposes paths for disabled services.
  for (const key of [
    'MEDIA_ROOT',
    'MUSIC_ROOT',
    'DOWNLOADS_ROOT',
    'TORRENT_ARCHIVE_ROOT',
    'CONFIG_ROOT',
    'STATE_ROOT',
    'LOG_ROOT'
  ]) {
    add(env[key], 'stackarr', key, 'configuration');
  }
  for (const service of services) {
    if (service.name === 'stackarr' || (service.mode === 'disabled' && service.name !== 'backup')) continue;
    for (const field of serviceStorageFields(service.name))
      add(env[field.key], service.name, field.label, 'configuration');
    add(service.configPath, service.name, 'Service configuration', 'configuration');
  }
  // On-demand backups remain associated even when schedules and the backup service are off.
  for (const field of serviceStorageFields('backup')) add(env[field.key], 'backup', field.label, 'configuration');
  for (const container of containers) {
    const labels = container.Config?.Labels ?? {};
    if (labels['com.docker.compose.project'] !== (input.project ?? composeProjectName)) continue;
    const name = labels['com.docker.compose.service'];
    const owner = enabled.find(
      (s) =>
        (s.name === 'stackarr' && ['stackarr', 'app', 'app-updater'].includes(name)) ||
        (s.mode === 'docker' &&
          s.dockerService &&
          (name === s.dockerService || name?.startsWith(`${s.dockerService}-`)))
    );
    if (!owner || (owner.name === 'stackarr' && controllers.length !== 1)) continue;
    for (const mount of container.Mounts ?? []) {
      // Named volumes belong to the daemon, not a host filesystem path. OS plumbing
      // is not application storage and must not pull arbitrary removable disks in.
      if (
        mount.Type !== 'bind' ||
        mount.Source.endsWith('.sock') ||
        ['/etc/localtime', '/etc/timezone'].includes(mount.Source) ||
        mount.Source.startsWith('/dev/')
      )
        continue;
      if (
        owner.name === 'stackarr' &&
        ![...associated].some((root) => mount.Source === root || mount.Source.startsWith(`${root.replace(/\/$/, '')}/`))
      )
        continue;
      add(mount.Source, owner.name, `Bind: ${mount.Destination}`, 'container-bind');
    }
  }
  for (const library of libraries) {
    if (enabled.some((s) => s.name === library.service && s.mode === 'native')) {
      add(library.path, library.service, library.reason, 'native-library');
    }
  }
  return [...new Map(roots.map((root) => [JSON.stringify(root), root])).values()];
}

export function plexLibraryLocations(value: unknown): LibraryLocation[] {
  const data = value as { MediaContainer?: { Directory?: Array<{ Location?: Array<{ path?: unknown }> }> } };
  return (data?.MediaContainer?.Directory ?? []).flatMap((section) =>
    (section.Location ?? []).flatMap((location) =>
      hostPath(location.path) ? [{ service: 'plex', path: location.path, reason: 'Library location' }] : []
    )
  );
}

const exec = promisify(execFile);
async function managedContainers(): Promise<StorageContainer[]> {
  const options = { encoding: 'utf8' as const, timeout: 2500, maxBuffer: 2 * 1024 * 1024 };
  const { stdout } = await exec(
    'docker',
    ['ps', '-aq', '--filter', `label=com.docker.compose.project=${composeProjectName}`],
    options
  );
  const ids = stdout
    .trim()
    .split(/\s+/)
    .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
  if (!ids.length) return [];
  // Only labels and mounts, never inspect's credential-bearing environment.
  const result = await exec(
    'docker',
    [
      'inspect',
      '--format',
      '{"Config":{"Labels":{{json .Config.Labels}}},"State":{"Running":{{json .State.Running}}},"Mounts":{{json .Mounts}}}',
      ...ids
    ],
    options
  );
  return result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

async function nativeLibraries(service: StorageService, suppliedEnv?: StackarrEnv): Promise<LibraryLocation[]> {
  if (!['plex', 'jellyfin'].includes(service.name) || service.mode !== 'native') return [];
  const env = suppliedEnv ?? readEnv();
  const configured = env[`${service.name.toUpperCase()}_URL`];
  // Host discovery never falls back to a DB-backed service URL resolver.
  const defaultUrl = suppliedEnv
    ? `http://127.0.0.1:${service.name === 'plex' ? 32400 : 8096}`
    : serviceBaseUrl(service.name);
  const endpoint = new URL(configured?.trim() || defaultUrl);
  const host = endpoint.hostname;
  // On the host, Compose's host aliases refer to this same machine; use loopback.
  if (suppliedEnv && ['host.docker.internal', 'host.containers.internal'].includes(host)) {
    endpoint.hostname = '127.0.0.1';
  }
  // An external server's filesystem must never be attributed to this host.
  const localHosts = suppliedEnv
    ? ['localhost', '127.0.0.1', '[::1]']
    : ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'host.containers.internal'];
  if (!localHosts.includes(endpoint.hostname)) {
    throw new Error('remote-library');
  }
  if (
    (suppliedEnv?.STACKARR_RUNTIME ?? process.env.STACKARR_RUNTIME) === 'docker' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(host)
  ) {
    endpoint.hostname = 'host.docker.internal';
  }
  const base = endpoint.toString().replace(/\/$/, '');
  // Host metadata discovery must not acquire macOS native-preferences TCC
  // authority through Node. Use an already configured token or report the
  // prerequisite. Existing controller-mounted preferences remain supported.
  const token = suppliedEnv
    ? serviceApiKey(service.name, process.platform === 'darwin' ? { ...suppliedEnv, PLEX_PREFS_PATH: '' } : suppliedEnv)
    : serviceApiKey(service.name);
  if (!token) throw new Error('authentication-unavailable');
  if (service.name === 'plex') {
    return plexLibraryLocations(
      await requestJson(`${base.replace(/\/$/, '')}/library/sections`, {
        headers: { accept: 'application/json', 'X-Plex-Token': token },
        timeoutMs: 2500
      })
    );
  }
  const data = await requestJson<Array<{ Locations?: unknown[] }>>(
    `${base.replace(/\/$/, '')}/Library/VirtualFolders`,
    {
      headers: { 'X-Emby-Token': token },
      timeoutMs: 2500
    }
  );
  return data.flatMap((library) =>
    (library.Locations ?? []).flatMap((location) =>
      hostPath(location) ? [{ service: 'jellyfin', path: location, reason: 'Library location' }] : []
    )
  );
}

export async function discoverServiceStorage(
  env: StackarrEnv,
  adapters = {
    services: getServices,
    containers: managedContainers,
    libraries: nativeLibraries
  },
  suppliedServices?: readonly StorageService[]
): Promise<StorageDiscovery> {
  const services = suppliedServices ?? adapters.services();
  const issues: StorageDiscovery['issues'] = [];
  const [containers, libraries] = await Promise.all([
    adapters.containers().catch(() => {
      issues.push({ service: 'docker', status: 'discovery-unavailable' });
      return [];
    }),
    Promise.all(
      services
        .filter((s) => s.mode === 'native')
        .map((s) =>
          adapters.libraries(s, suppliedServices ? env : undefined).catch((error: unknown) => {
            issues.push({
              service: s.name,
              status:
                error instanceof Error && error.message === 'authentication-unavailable'
                  ? 'authentication-unavailable'
                  : 'library-discovery-unavailable'
            });
            return [];
          })
        )
    )
  ]);
  return { roots: collectServiceStorage({ env, services, containers, libraries: libraries.flat() }), issues };
}

/** Host-only discovery: supplied environment is the sole configuration source. */
export function discoverHostServiceStorage(env: StackarrEnv): Promise<StorageDiscovery> {
  return discoverServiceStorage(
    env,
    {
      services: () => servicesFromEnv(env),
      containers: managedContainers,
      libraries: (service) => nativeLibraries(service, env)
    },
    servicesFromEnv(env)
  );
}
