import { readEnv } from '../env';

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
  plex: 32400,
  transmission: 9091,
  qbittorrent: 8081,
  bookorbit: 7582
};

const containerDefaults: Record<string, number> = {
  ...defaults,
  sonarr4k: 8989,
  radarr4k: 7878,
  bookorbit: 7582
};

export function serviceBaseUrl(service: string) {
  const env = readEnv();
  const prefix = service.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const configured = env[`${prefix}_URL`] ?? env[`${prefix}_BASE_URL`];
  const stackarrRuntime = env.STACKARR_RUNTIME ?? process.env.STACKARR_RUNTIME;
  const dockerPort =
    service === 'bookorbit'
      ? Number(env.BOOKORBIT_CONTAINER_PORT ?? containerDefaults.bookorbit)
      : containerDefaults[service];
  const port = stackarrRuntime === 'docker' ? dockerPort : defaults[service];
  const host = stackarrRuntime === 'docker' && port ? service : '127.0.0.1';

  if (configured) {
    return stackarrRuntime === 'docker' && port
      ? configured.replace(/^(https?:\/\/)(127\.0\.0\.1|localhost)(?::\d+)?/i, `$1${service}:${port}`)
      : configured;
  }

  return `http://${host}:${port}`;
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
