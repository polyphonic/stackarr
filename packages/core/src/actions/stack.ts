import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { databaseExists } from '../database';
import { editableEnvKeys, readEnv, redactEnv, type StackarrEnv, writeEnvConfig } from '../env';
import { appDatabasePath, repoRoot } from '../paths';
import { redactSecrets } from '../safety/redaction';
import { getSystemStatus } from '../services';

const execFileAsync = promisify(execFile);

export function getSystemStatusAction() {
  return getSystemStatus();
}

export function getStackConfigSummaryAction() {
  const env = readEnv();
  return redactSecrets({ databasePath: appDatabasePath, configured: databaseExists(), editableEnvKeys, env });
}

export function updateStackConfigAction(input: { values: Record<string, unknown> }) {
  const patch: StackarrEnv = {};

  for (const [key, value] of Object.entries(input.values ?? {})) {
    if (editableEnvKeys.includes(key)) {
      patch[key] = String(value ?? '');
    }
  }

  const env = writeEnvConfig(patch);
  return {
    accepted: true,
    updatedKeys: Object.keys(patch),
    env: redactEnv(env)
  };
}

export type CloudflareTunnelRoute = {
  hostname: string;
  service: string;
};

export function getCloudflareRoutesAction() {
  const env = readEnv();
  return {
    tunnelName: env.CLOUDFLARED_TUNNEL_NAME || 'stackarr',
    tunnelId: env.CLOUDFLARED_TUNNEL_ID || '',
    routes: readCloudflareTunnelRoutes(env)
  };
}

export function updateCloudflareRoutesAction(input: { routes: CloudflareTunnelRoute[] }) {
  const routes = normalizeCloudflareTunnelRoutes(input.routes);
  const env = writeEnvConfig({
    CLOUDFLARE_TUNNEL_ROUTES: routes.length ? JSON.stringify(routes) : '',
    CLOUDFLARED_TUNNEL_NAME: 'stackarr'
  });

  return {
    accepted: true,
    routes,
    env: redactEnv(env)
  };
}

export async function getDiskUsageAction() {
  const env = readEnv();
  const roots = [repoRoot, env.MEDIA_ROOT, env.MUSIC_ROOT, env.DOWNLOADS_ROOT, env.BACKUP_ROOT].filter(
    Boolean
  ) as string[];
  const uniqueRoots = [...new Set(roots.map((rootPath) => rootPath.replace(/^~(?=\/)/, os.homedir())))];
  return Promise.all(
    uniqueRoots.map(async (rootPath) => {
      try {
        const { stdout } = await execFileAsync('df', ['-k', rootPath]);
        const [, line] = stdout.trim().split(/\r?\n/);
        const [filesystem, blocks, used, available, capacity, mountedOn] = line.trim().split(/\s+/);
        return {
          path: rootPath,
          filesystem,
          blocks: Number(blocks),
          used: Number(used),
          available: Number(available),
          capacity,
          mountedOn
        };
      } catch (error) {
        return { path: rootPath, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );
}

function readCloudflareTunnelRoutes(env: StackarrEnv): CloudflareTunnelRoute[] {
  return normalizeCloudflareTunnelRoutes(parseCloudflareTunnelRoutes(env.CLOUDFLARE_TUNNEL_ROUTES));
}

function parseCloudflareTunnelRoutes(value: string | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCloudflareTunnelRoutes(routes: unknown[]): CloudflareTunnelRoute[] {
  const seen = new Set<string>();
  const normalized: CloudflareTunnelRoute[] = [];

  for (const route of routes) {
    if (!route || typeof route !== 'object') {
      continue;
    }

    const item = route as Record<string, unknown>;
    const hostname = normalizeHostname(String(item.hostname ?? ''));
    const service = normalizeCloudflareService(String(item.service ?? ''));

    if (!hostname || !service || seen.has(hostname)) {
      continue;
    }

    seen.add(hostname);
    normalized.push({ hostname, service });
  }

  return normalized;
}

function normalizeHostname(value: string) {
  try {
    return value
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

function normalizeCloudflareService(value: string) {
  const service = value.trim().toLowerCase();
  const allowed = new Set([
    'stackarr',
    'pulsarr',
    'maintainerr',
    'bookorbit',
    'seerr',
    'plex',
    'jellyfin',
    'tinymm',
    'radarr',
    'sonarr',
    'lidarr',
    'prowlarr',
    'bazarr',
    'transmission',
    'qbittorrent'
  ]);

  return allowed.has(service) ? service : '';
}
