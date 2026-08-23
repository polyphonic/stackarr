import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEnv } from '../env';
import { getServices, type ServiceSummary } from '../services';

export type ArrInstance = 'sonarr' | 'sonarr4k' | 'radarr' | 'radarr4k' | 'lidarr';
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
  cleanuparr: 11011,
  agregarr: 7171,
  tracearr: 3000,
  plex: 32400,
  transmission: 9091,
  qbittorrent: 8081,
  bookorbit: 7582,
  immich: 2283,
  romm: 7583,
  questarr: 7584,
  youtarr: 3087,
  bazarr: 6767,
  tinymediamanager: 7878,
  flaresolverr: 8191,
  tidarr: 8484
};

const containerDefaults: Record<string, number> = {
  ...defaults,
  sonarr4k: 8989,
  radarr4k: 7878,
  jellyfin: 8096,
  bookorbit: 7582,
  immich: 2283,
  romm: 8080,
  questarr: 5000,
  youtarr: 3011
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
  const stackarrRuntime = process.env.STACKARR_RUNTIME?.trim() || env.STACKARR_RUNTIME?.trim();
  const summary = getServices().find((item) => item.name === service);
  const dockerPort = containerPort(service, env, summary);
  const port = stackarrRuntime === 'docker' ? dockerPort : (summary?.port ?? defaults[service]);
  const host = stackarrRuntime === 'docker' ? containerHost(service, summary) : '127.0.0.1';

  if (stackarrRuntime === 'docker' && host && port) {
    return `http://${host}:${port}`;
  }

  if (configured) {
    return trimTrailingSlash(configured);
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
  if (service === 'questarr') return Number(env.QUESTARR_CONTAINER_PORT ?? containerDefaults.questarr);
  if (service === 'youtarr') return Number(env.YOUTARR_CONTAINER_PORT ?? containerDefaults.youtarr);
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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function serviceApiKey(service: string) {
  const env = readEnv();
  const authoritativeServarrKey = readServarrApiKey(service, env.CONFIG_ROOT);
  if (authoritativeServarrKey) return authoritativeServarrKey;

  const prefix = service.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const configured = env[`${prefix}_API_KEY`] ?? env[`${prefix}_APIKEY`] ?? env[`${prefix}_TOKEN`];
  if (configured?.trim()) return configured.trim();

  if (service === 'plex') return readPlexToken(env.PLEX_PREFS_PATH);
  return undefined;
}

const servarrConfigDirectories: Record<string, string> = {
  sonarr: 'sonarr',
  sonarr4k: 'sonarr4k',
  radarr: 'radarr',
  radarr4k: 'radarr4k',
  prowlarr: 'prowlarr',
  lidarr: 'lidarr'
};

/**
 * Local Arr deployments persist their API key in config.xml. MCP runs beside
 * Stackarr and should use that authoritative service configuration when an
 * optional duplicate environment secret has not been populated.
 */
function readServarrApiKey(service: string, configRoot: string | undefined) {
  const directory = servarrConfigDirectories[service];
  if (!directory || !configRoot?.trim()) return undefined;
  return readXmlElement(join(configRoot, directory, 'config.xml'), 'ApiKey');
}

/** Native Plex stores its server token as an XML attribute in Preferences.xml. */
function readPlexToken(preferencesPath: string | undefined) {
  if (!preferencesPath?.trim()) return undefined;
  const contents = readLocalFile(preferencesPath);
  const attributeMatch = contents?.match(/\bPlexOnlineToken=(?:"([^"]*)"|'([^']*)')/i);
  const plistMatch = contents?.match(/<key>\s*PlexOnlineToken\s*<\/key>\s*<string>([^<]*)<\/string>/i);
  const fromContents = decodeXml(attributeMatch?.[1] ?? attributeMatch?.[2] ?? plistMatch?.[1]);
  if (fromContents) return fromContents;

  // macOS commonly stores this preferences file as a binary plist. Use the
  // platform parser when available rather than duplicating the secret in env.
  if (process.platform !== 'darwin') return undefined;
  try {
    return (
      execFileSync('/usr/bin/plutil', ['-extract', 'PlexOnlineToken', 'raw', '-o', '-', preferencesPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function readXmlElement(filePath: string, elementName: string) {
  const contents = readLocalFile(filePath);
  const match = contents?.match(new RegExp(`<${elementName}>([^<]*)</${elementName}>`, 'i'));
  return decodeXml(match?.[1]);
}

function readLocalFile(filePath: string) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function decodeXml(value: string | undefined) {
  const decoded = value
    ?.trim()
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return decoded || undefined;
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
