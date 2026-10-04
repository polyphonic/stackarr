import fs from 'node:fs';
import path from 'node:path';
import { readEnv, type StackarrEnv, writeEnvConfig } from './env';

const apiBase = 'https://api.cloudflare.com/client/v4';
const policyName = 'Email Allowlist';

export type CloudflareManagedRoute = {
  hostname: string;
  service: string;
  access: boolean;
};

export type CloudflareExternalRoute = {
  hostname: string;
  target: string;
  access: boolean;
};

export type CloudflareSyncResult = {
  syncedAt: string;
  apiTokenConfigured: boolean;
  tunnelName: string;
  managedRoutes: CloudflareManagedRoute[];
  externalRoutes: CloudflareExternalRoute[];
  access: {
    enabled: boolean;
    policyName: string;
    allowedEmails: string[];
    sessionDuration: string;
  };
  config: StackarrEnv;
};

export type CloudflareSyncDependencies = {
  readEnv?: () => StackarrEnv;
  writeEnvConfig?: (patch: StackarrEnv) => StackarrEnv;
  fetch?: typeof fetch;
  readFile?: (file: string) => string;
  now?: () => Date;
};

type ApiPayload<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
};

type IngressRule = { hostname?: unknown; service?: unknown };
type AccessApp = {
  domain?: unknown;
  self_hosted_domains?: unknown;
  session_duration?: unknown;
};
type AccessPolicy = { id?: unknown; name?: unknown; include?: unknown; session_duration?: unknown };

export async function syncCloudflareRuntimeConfig(
  dependencies: CloudflareSyncDependencies = {}
): Promise<CloudflareSyncResult> {
  const readCurrent = dependencies.readEnv ?? readEnv;
  const writeConfig = dependencies.writeEnvConfig ?? writeEnvConfig;
  const fetchImpl = dependencies.fetch ?? fetch;
  const readFile = dependencies.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
  const env = readCurrent();
  const apiToken = resolveApiToken(env, readFile);

  if (!apiToken) {
    throw new Error('Cloudflare API token is not configured. Save a token or restore its protected state file.');
  }

  const connector = resolveConnectorIdentity(env, readFile);
  const accountId = connector.accountId || env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const tunnelId = connector.tunnelId || env.CLOUDFLARED_TUNNEL_ID?.trim();
  if (!accountId || !tunnelId) {
    throw new Error('Cloudflare account or tunnel identity is unavailable. Restore the connector token first.');
  }

  const request = createRequest(fetchImpl, apiToken);
  const [tunnel, configuration, apps, policies] = await Promise.all([
    request<{ id?: unknown; name?: unknown }>(`/accounts/${accountId}/cfd_tunnel/${tunnelId}`),
    request<{ config?: { ingress?: unknown } }>(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`),
    request<AccessApp[]>(`/accounts/${accountId}/access/apps?per_page=1000`),
    request<AccessPolicy[]>(`/accounts/${accountId}/access/policies?per_page=1000`)
  ]);
  const protectedHostnames = accessAppHostnames(apps);
  const routes = readRemoteRoutes(configuration.config?.ingress, env, protectedHostnames);
  const policy = readEmailAllowlist(policies);
  const sessionDuration = policy.sessionDuration || accessAppSessionDuration(apps) || '720h';
  const firstHostname = [...routes.managed, ...routes.external][0]?.hostname;
  const zoneId = firstHostname ? await resolveZoneId(request, firstHostname) : env.CLOUDFLARE_ZONE_ID || '';
  const patch: StackarrEnv = {
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_ZONE_ID: zoneId,
    CLOUDFLARED_TUNNEL_ID: String(tunnel.id || tunnelId),
    CLOUDFLARED_TUNNEL_NAME: String(tunnel.name || env.CLOUDFLARED_TUNNEL_NAME || 'stackarr'),
    CLOUDFLARE_ROUTE_MANAGED: 'true',
    CLOUDFLARE_TUNNEL_ROUTES: routes.managed.length ? JSON.stringify(routes.managed) : '',
    CLOUDFLARE_ACCESS_ENABLED: [...routes.managed, ...routes.external].some((route) => route.access) ? 'true' : 'false',
    CLOUDFLARE_ACCESS_ALLOWED_EMAILS: policy.allowedEmails.join(','),
    CLOUDFLARE_ACCESS_SESSION_DURATION: sessionDuration
  };
  const config = writeConfig(patch);

  return {
    syncedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    apiTokenConfigured: true,
    tunnelName: patch.CLOUDFLARED_TUNNEL_NAME || 'stackarr',
    managedRoutes: routes.managed,
    externalRoutes: routes.external,
    access: {
      enabled: patch.CLOUDFLARE_ACCESS_ENABLED === 'true',
      policyName,
      allowedEmails: policy.allowedEmails,
      sessionDuration
    },
    config
  };
}

export async function publishCloudflareEmailAllowlist(
  requestedEmails: string[],
  dependencies: CloudflareSyncDependencies = {}
) {
  const allowedEmails = normalizeEmailAllowlist(requestedEmails);
  if (allowedEmails.length === 0) {
    throw new Error('Enter at least one valid email address before publishing Cloudflare Access.');
  }

  const readCurrent = dependencies.readEnv ?? readEnv;
  const writeConfig = dependencies.writeEnvConfig ?? writeEnvConfig;
  const fetchImpl = dependencies.fetch ?? fetch;
  const readFile = dependencies.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
  const env = readCurrent();
  const apiToken = resolveApiToken(env, readFile);
  if (!apiToken) throw new Error('Cloudflare API token is not configured.');

  const connector = resolveConnectorIdentity(env, readFile);
  const accountId = connector.accountId || env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) throw new Error('Cloudflare account identity is unavailable.');

  const request = createRequest(fetchImpl, apiToken);
  const policies = await request<AccessPolicy[]>(`/accounts/${accountId}/access/policies?per_page=1000`);
  const existing = policies.find((policy) => policy.name === policyName);
  const body = {
    name: policyName,
    decision: 'allow',
    include: allowedEmails.map((email) => ({ email: { email } })),
    exclude: [],
    require: [],
    session_duration: env.CLOUDFLARE_ACCESS_SESSION_DURATION || '720h'
  };
  const endpoint = existing?.id
    ? `/accounts/${accountId}/access/policies/${String(existing.id)}`
    : `/accounts/${accountId}/access/policies`;
  await request(endpoint, { method: existing?.id ? 'PUT' : 'POST', body });
  const config = writeConfig({
    CLOUDFLARE_ACCESS_ENABLED: 'true',
    CLOUDFLARE_ACCESS_ALLOWED_EMAILS: allowedEmails.join(',')
  });

  return {
    publishedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    policyName,
    allowedEmails,
    config
  };
}

function resolveApiToken(env: StackarrEnv, readFile: (file: string) => string) {
  const configured = env.CLOUDFLARE_API_TOKEN?.trim();
  if (configured) return configured;
  return readFirstSecret(
    [path.join(env.STATE_ROOT || '', 'cloudflare-api-token'), '/stackarr-state/cloudflare-api-token'],
    readFile
  );
}

function resolveConnectorIdentity(env: StackarrEnv, readFile: (file: string) => string) {
  const token = readFirstSecret(
    [
      env.CLOUDFLARED_TOKEN_FILE || '',
      path.join(env.STATE_ROOT || '', 'cloudflared-token'),
      '/stackarr-state/cloudflared-token'
    ],
    readFile
  );
  if (!token) return { accountId: '', tunnelId: '' };

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { a?: unknown; t?: unknown };
    return {
      accountId: typeof payload.a === 'string' ? payload.a : '',
      tunnelId: typeof payload.t === 'string' ? payload.t : ''
    };
  } catch {
    return { accountId: '', tunnelId: '' };
  }
}

function readFirstSecret(files: string[], readFile: (file: string) => string) {
  for (const file of [...new Set(files.filter(Boolean))]) {
    try {
      const value = readFile(file)
        .replace(/[\r\n]/g, '')
        .trim();
      if (value) return value;
    } catch {
      // Continue through portable and container-specific protected state paths.
    }
  }
  return '';
}

function createRequest(fetchImpl: typeof fetch, apiToken: string) {
  return async function request<T>(
    endpoint: string,
    init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}
  ): Promise<T> {
    const response = await fetchImpl(`${apiBase}${endpoint}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = (await response.json().catch(() => ({}))) as ApiPayload<T>;
    if (!response.ok || payload.success === false || payload.result === undefined) {
      const detail = payload.errors?.find((error) => error.message)?.message;
      throw new Error(
        detail ? `Cloudflare sync failed: ${detail}` : `Cloudflare sync failed with HTTP ${response.status}.`
      );
    }
    return payload.result;
  };
}

function normalizeEmailAllowlist(values: string[]) {
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const email = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Enter a valid email address: ${email}`);
    }
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  return emails;
}

function readRemoteRoutes(ingress: unknown, env: StackarrEnv, protectedHostnames: Set<string>) {
  const managed: CloudflareManagedRoute[] = [];
  const external: CloudflareExternalRoute[] = [];
  const seen = new Set<string>();
  for (const candidate of Array.isArray(ingress) ? ingress : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const route = candidate as IngressRule;
    const hostname = normalizeHostname(route.hostname);
    const target = String(route.service ?? '').trim();
    if (!hostname || !target || target.startsWith('http_status:') || seen.has(hostname)) continue;
    seen.add(hostname);
    const access = protectedHostnames.has(hostname);
    const service = serviceFromTarget(target, env);
    if (service) managed.push({ hostname, service, access });
    else external.push({ hostname, target: safeRouteTarget(target), access });
  }
  return { managed, external };
}

function serviceFromTarget(target: string, env: StackarrEnv) {
  try {
    const parsed = new URL(target);
    // Only the origin emitted by cloudflare_service_url (or its local/container
    // host aliases) belongs to Stackarr. An unrelated host can share its port.
    if (
      parsed.protocol !== 'http:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return '';
    const port = parsed.port || '80';
    const ports = new Map([
      [env.STACKARR_WEB_PORT || '7777', 'stackarr'],
      [env.PULSARR_PORT || '3003', 'pulsarr'],
      [env.TDARR_WEB_PORT || '8265', 'tdarr'],
      [env.MAINTAINERR_PORT || '6246', 'maintainerr'],
      [env.TRACEARR_PORT || '3000', 'tracearr'],
      [env.BOOKORBIT_WEB_PORT || '42873', 'bookorbit'],
      [env.IMMICH_WEB_PORT || '2283', 'immich'],
      [env.ROMM_WEB_PORT || '7583', 'romm'],
      [env.QUESTARR_WEB_PORT || '7584', 'questarr'],
      [env.YOUTARR_WEB_PORT || '3087', 'youtarr'],
      ['5055', 'seerr'],
      ['9091', 'transmission'],
      [env.QBITTORRENT_WEBUI_PORT || '8081', 'qbittorrent'],
      [env.PLEX_DOCKER_PORT || '32400', 'plex'],
      [env.JELLYFIN_DOCKER_PORT || '8096', 'jellyfin'],
      ['4000', 'tinymm'],
      ['7878', 'radarr'],
      ['8989', 'sonarr'],
      ['8686', 'lidarr'],
      ['9696', 'prowlarr'],
      ['6767', 'bazarr']
    ]);
    const service = ports.get(port) || '';
    if (!service) return '';
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']);
    const aliases: Record<string, string[]> = {
      stackarr: ['app', 'dashboard'],
      pulsarr: ['requests'],
      maintainerr: ['cleanup'],
      tracearr: ['monitoring', 'analytics'],
      bookorbit: ['books'],
      immich: ['photos', 'pics'],
      romm: ['games'],
      questarr: ['game-downloads'],
      youtarr: ['youtube'],
      tinymm: ['tinymediamanager']
    };
    return localHosts.has(host) || host === service || aliases[service]?.includes(host) ? service : '';
  } catch {
    return '';
  }
}

function safeRouteTarget(target: string) {
  try {
    const parsed = new URL(target);
    if (!parsed.username && !parsed.password) return target;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return target;
  }
}

function accessAppHostnames(apps: AccessApp[]) {
  const hostnames = new Set<string>();
  for (const app of Array.isArray(apps) ? apps : []) {
    const domains = [app.domain];
    if (Array.isArray(app.self_hosted_domains)) {
      for (const item of app.self_hosted_domains) {
        const value =
          item && typeof item === 'object'
            ? ((item as { domain?: unknown; hostname?: unknown }).domain ?? (item as { hostname?: unknown }).hostname)
            : item;
        domains.push(value);
      }
    }
    for (const domain of domains) {
      const hostname = normalizeHostname(domain);
      if (hostname) hostnames.add(hostname);
    }
  }
  return hostnames;
}

function accessAppSessionDuration(apps: AccessApp[]) {
  for (const app of Array.isArray(apps) ? apps : []) {
    const duration = String(app.session_duration ?? '').trim();
    if (duration) return duration;
  }
  return '';
}

function readEmailAllowlist(policies: AccessPolicy[]) {
  const policy = (Array.isArray(policies) ? policies : []).find((item) => item.name === policyName);
  const allowedEmails: string[] = [];
  const seen = new Set<string>();
  for (const rule of Array.isArray(policy?.include) ? policy.include : []) {
    if (!rule || typeof rule !== 'object') continue;
    const emailRule = (rule as { email?: unknown }).email;
    const value = emailRule && typeof emailRule === 'object' ? (emailRule as { email?: unknown }).email : emailRule;
    const email = String(value ?? '')
      .trim()
      .toLowerCase();
    if (email && !seen.has(email)) {
      seen.add(email);
      allowedEmails.push(email);
    }
  }
  return { allowedEmails, sessionDuration: String(policy?.session_duration ?? '').trim() };
}

async function resolveZoneId(request: <T>(endpoint: string) => Promise<T>, hostname: string) {
  const labels = hostname.split('.');
  for (let index = 0; index <= Math.max(0, labels.length - 2); index += 1) {
    const candidate = labels.slice(index).join('.');
    const zones = await request<Array<{ id?: unknown; name?: unknown }>>(
      `/zones?name=${encodeURIComponent(candidate)}`
    );
    const match = zones.find((zone) => String(zone.name ?? '').toLowerCase() === candidate);
    if (match?.id) return String(match.id);
  }
  return '';
}

function normalizeHostname(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
}
