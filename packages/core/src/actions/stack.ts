import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { databaseExists } from '../database';
import {
  controlPlaneBoundaryEnvConfigChanged,
  credentialEnvConfigChanged,
  editableEnvKeys,
  readEnv,
  redactEnv,
  type StackarrEnv,
  writeEnvConfig
} from '../env';
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

export function updateStackConfigAction(input: {
  values: Record<string, unknown>;
  trustedControlPlaneApproval?: boolean;
}) {
  const current = readEnv();
  const patch: StackarrEnv = {};

  for (const [key, value] of Object.entries(input.values ?? {})) {
    if (editableEnvKeys.includes(key)) {
      patch[key] = String(value ?? '');
    }
  }

  if (credentialEnvConfigChanged(patch, current)) {
    return {
      accepted: false,
      updatedKeys: [],
      error: 'Account credentials and secrets cannot be changed through the MCP stack config action.'
    };
  }

  if (controlPlaneBoundaryEnvConfigChanged(patch, current) && !input.trustedControlPlaneApproval) {
    return {
      accepted: false,
      updatedKeys: [],
      error: 'Endpoint, bind-address, and image changes require trusted control-plane approval.'
    };
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
  access?: boolean;
};

export function getCloudflareRoutesAction() {
  const env = readEnv();
  return {
    tunnelName: env.CLOUDFLARED_TUNNEL_NAME || 'stackarr',
    tunnelId: env.CLOUDFLARED_TUNNEL_ID || '',
    access: cloudflareAccessSummary(env),
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

export function getCloudflareAccessAction() {
  return cloudflareAccessSummary(readEnv());
}

export function updateCloudflareAccessAction(input: {
  enabled?: boolean;
  allowedEmails?: string[] | string;
  sessionDuration?: string;
}) {
  const patch: StackarrEnv = {};

  if (typeof input.enabled === 'boolean') {
    patch.CLOUDFLARE_ACCESS_ENABLED = input.enabled ? 'true' : 'false';
  }

  if (input.allowedEmails !== undefined) {
    patch.CLOUDFLARE_ACCESS_ALLOWED_EMAILS = normalizeCloudflareAccessEmails(input.allowedEmails).join(',');
  }

  if (input.sessionDuration !== undefined) {
    patch.CLOUDFLARE_ACCESS_SESSION_DURATION = String(input.sessionDuration || '720h');
  }

  const env = writeEnvConfig(patch);

  return {
    accepted: true,
    updatedKeys: Object.keys(patch),
    access: cloudflareAccessSummary(env),
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
    const access = normalizeCloudflareRouteAccess(item.access, service);

    normalized.push({ hostname, service, access });
  }

  return normalized;
}

function cloudflareAccessSummary(env: StackarrEnv) {
  return {
    enabled: env.CLOUDFLARE_ACCESS_ENABLED === 'true',
    policyName: 'Email Allowlist',
    allowedEmails: normalizeCloudflareAccessEmails(env.CLOUDFLARE_ACCESS_ALLOWED_EMAILS),
    sessionDuration: env.CLOUDFLARE_ACCESS_SESSION_DURATION || '720h',
    requiredPermissions: [
      'Account: Cloudflare Tunnel - Edit',
      'Account: Access: Policies - Edit',
      'Account: Zero Trust - Edit',
      'Zone: Zone - Read',
      'Zone: DNS - Edit'
    ]
  };
}

function normalizeCloudflareAccessEmails(value: string[] | string | undefined) {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const item of raw.split(/[\s,;]+/)) {
    const email = item.trim().toLowerCase();

    if (!email || !email.includes('@') || seen.has(email)) {
      continue;
    }

    seen.add(email);
    emails.push(email);
  }

  return emails;
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
    'tracearr',
    'bookorbit',
    'immich',
    'romm',
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

function defaultCloudflareRouteAccess(service: string) {
  return !['immich', 'photos', 'pics'].includes(service.trim().toLowerCase());
}

function normalizeCloudflareRouteAccess(value: unknown, service: string) {
  if (typeof value === 'boolean') {
    return value;
  }

  const token = String(value ?? '')
    .trim()
    .toLowerCase();

  if (['1', 'true', 'yes', 'on', 'access', 'protected'].includes(token)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'public', 'mobile', 'none'].includes(token)) {
    return false;
  }

  return defaultCloudflareRouteAccess(service);
}
