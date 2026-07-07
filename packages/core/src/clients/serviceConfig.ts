import { readEnv } from '../env';
import { getServices, type ServiceSummary } from '../services';

export type ArrInstance = 'sonarr' | 'sonarr4k' | 'radarr' | 'radarr4k';
export type Downloader = 'transmission' | 'qbittorrent';

const defaults: Record<string, number> = {
  sonarr: 8989,
  sonarr4k: 8990,
  radarr: 7878,
  radarr4k: 7879,
  prowlarr: 9696,
  lidarr: 8686,
  seerr: 5055,
  pulsarr: 3003,
  maintainerr: 6246,
  tracearr: 3000,
  plex: 32400,
  transmission: 9091,
  qbittorrent: 8081,
  bookorbit: 7582,
  immich: 2283,
  romm: 7583
};

const containerDefaults: Record<string, number> = {
  ...defaults,
  sonarr4k: 8989,
  radarr4k: 7878,
  jellyfin: 8096,
  bookorbit: 7582,
  immich: 2283,
  romm: 8080
};

export function serviceBaseUrl(service: string) {
  const baseUrl = maybeServiceBaseUrl(service);
  if (!baseUrl) {
    throw new Error(`${service} does not expose an HTTP endpoint.`);
  }

  return baseUrl;
}

export function maybeServiceBaseUrl(service: string) {
  const env = readEnv();
  const prefix = service.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const configured = env[`${prefix}_URL`] ?? env[`${prefix}_BASE_URL`];
  const stackarrRuntime = env.STACKARR_RUNTIME?.trim() || process.env.STACKARR_RUNTIME?.trim();
  const summary = getServices().find((item) => item.name === service);
  const dockerPort = containerPort(service, env, summary);
  const port = stackarrRuntime === 'docker' ? dockerPort : (summary?.port ?? defaults[service]);
  const host = stackarrRuntime === 'docker' ? containerHost(service, summary) : '127.0.0.1';

  if (configured) {
    return stackarrRuntime === 'docker' && host && port
      ? rewriteLocalUrl(configured, host, port)
      : trimTrailingSlash(configured);
  }

  if (!host || !port) {
    return undefined;
  }

  return `http://${host}:${port}`;
}

function containerPort(service: string, env: ReturnType<typeof readEnv>, summary?: ServiceSummary) {
  if (service === 'bookorbit') return Number(env.BOOKORBIT_CONTAINER_PORT ?? containerDefaults.bookorbit);
  if (service === 'immich') return Number(env.IMMICH_CONTAINER_PORT ?? containerDefaults.immich);
  if (service === 'romm') return Number(env.ROMM_CONTAINER_PORT ?? containerDefaults.romm);
  if (service === 'jellyfin') return Number(env.JELLYFIN_DOCKER_PORT ?? containerDefaults.jellyfin);
  return containerDefaults[service] ?? summary?.port;
}

function containerHost(service: string, summary?: ServiceSummary) {
  if (summary?.mode === 'docker') {
    return summary.dockerService ?? service;
  }

  if (summary?.mode === 'native' && (service === 'plex' || service === 'jellyfin')) {
    return 'host.docker.internal';
  }

  return undefined;
}

function rewriteLocalUrl(raw: string, host: string, port: number) {
  try {
    const url = new URL(raw);
    if (isLocalHostname(url.hostname)) {
      url.hostname = host;
      url.port = String(port);
    }
    return trimTrailingSlash(url.toString());
  } catch {
    return trimTrailingSlash(raw);
  }
}

function isLocalHostname(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function serviceApiKey(service: string) {
  const env = readEnv();
  const prefix = service.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return env[`${prefix}_API_KEY`] ?? env[`${prefix}_APIKEY`] ?? env[`${prefix}_TOKEN`];
}

export function selectedDownloader(input?: Downloader): Downloader {
  const env = readEnv();
  const configured = normalizeTorrentClient(input ?? env.PREFERRED_TORRENT_CLIENT ?? 'transmission');
  return configured === 'qbittorrent' ? 'qbittorrent' : 'transmission';
}

function normalizeTorrentClient(value: string): Downloader {
  const candidate = value.toLowerCase().trim();

  if (candidate === 'qb' || candidate === 'qbit' || candidate === 'qbittorrent') {
    return 'qbittorrent';
  }

  return 'transmission';
}
