import { requestJson, ServiceApiError, withQuery } from '../clients/http';
import { maybeServiceBaseUrl, serviceApiKey } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { redactSecrets } from '../safety/redaction';
import { getServices } from '../services';
import { getMediaSearchReconciliationStatusAction } from './mediaReconciliation';
import { getPlexServerStatusAction } from './plex';
import { getServiceStatusAction } from './services';

export const diagnoseServiceAction = (input: { service: string }) => getServiceStatusAction(input);
export const testServiceApiAction = (input: { service: string }) => getServiceStatusAction(input);
export const testServiceConnectivityAction = (input: { service: string }) => getServiceStatusAction(input);
export const testArrToDownloaderAction = () => ({
  status: 'notImplemented',
  note: 'Safe diagnostic placeholder; no services mutated.'
});
export const testProwlarrToArrAction = () => ({
  status: 'notImplemented',
  note: 'Safe diagnostic placeholder; no services mutated.'
});
export const testSeerrToArrAction = () => ({
  status: 'notImplemented',
  note: 'Safe diagnostic placeholder; no services mutated.'
});
export const testPlexIdentityAction = () => getPlexServerStatusAction();
export const getCommonIssuesAction = () => {
  const env = readEnv();
  const issues = [
    { id: 'missing-api-key', title: 'Missing API key', fix: 'Save the service API key in Stackarr configuration.' },
    { id: 'wrong-base-url', title: 'Wrong service base URL', fix: 'Set SERVICE_URL to the reachable address.' }
  ];

  if (/^(1|true|yes|on)$/i.test(env.ENABLE_4K_SERVARR ?? '')) {
    issues.push({
      id: 'seerr-sonarr4k',
      title: 'Seerr cannot reach Sonarr 4K',
      fix: 'Verify Seerr service settings point Sonarr 4K to http://sonarr4k:8989 inside Docker or the configured host URL from Seerr network.'
    });
  }

  return issues;
};
export const applySafeFixAction = (input: { fixId: 'refresh-status-cache' | 'none' }) => ({
  fixId: input.fixId,
  applied: input.fixId === 'refresh-status-cache',
  note: 'Only enumerated no-downtime safe fixes are allowed.'
});
export const checkServiceDatabasesAction = () => ({
  status: 'notImplemented',
  note: 'Database checks are pending; no services touched.'
});
export const validateSqliteDbAction = (input: { path: string }) => ({
  path: input.path,
  status: 'notImplemented',
  note: 'SQLite validation pending.'
});

export type AppHealthIssue = {
  severity: 'warning' | 'error';
  source: string;
  message: string;
};

export type AppHealthCheck = {
  service: string;
  displayName: string;
  status: 'healthy' | 'issues' | 'unavailable' | 'unsupported';
  issues: AppHealthIssue[];
};

export type AppHealthSummary = {
  checkedAt: string;
  checks: AppHealthCheck[];
  healthyCount: number;
  issueCount: number;
  unavailableCount: number;
  unsupportedCount: number;
};

type HealthCheckSpec = {
  path: string;
  method?: 'GET' | 'POST';
  credential?: 'query' | 'api-key' | 'bearer' | 'immich' | 'jellyfin' | 'optional-bearer';
  body?: unknown;
  issueArray?: boolean;
  reachableStatuses?: number[];
};

const healthChecks: Record<string, HealthCheckSpec> = {
  prowlarr: { path: '/api/v1/health', credential: 'api-key', issueArray: true },
  lidarr: { path: '/api/v1/health', credential: 'api-key', issueArray: true },
  radarr: { path: '/api/v3/health', credential: 'api-key', issueArray: true },
  radarr4k: { path: '/api/v3/health', credential: 'api-key', issueArray: true },
  sonarr: { path: '/api/v3/health', credential: 'api-key', issueArray: true },
  sonarr4k: { path: '/api/v3/health', credential: 'api-key', issueArray: true },
  seerr: { path: '/api/v1/status', credential: 'api-key' },
  pulsarr: { path: '/health' },
  maintainerr: { path: '/api/health' },
  tracearr: { path: '/api/v1/public/health', credential: 'bearer' },
  bookorbit: { path: '/api/v1/health' },
  romm: { path: '/api/heartbeat', credential: 'optional-bearer' },
  youtarr: { path: '/api/health' },
  jellyfin: { path: '/System/Info/Public' },
  immich: { path: '/api/server/about', credential: 'immich' },
  agregarr: { path: '/api/v1/status' },
  bazarr: { path: '/api/system/status', credential: 'api-key' },
  flaresolverr: { path: '/v1', method: 'POST', body: { cmd: 'sessions.list' } },
  // Cleanuparr protects this endpoint outside its own container. A 401 still
  // proves that the application is running and its HTTP middleware is ready.
  cleanuparr: { path: '/api/health', reachableStatuses: [401] }
};

export async function getAppHealthSummaryAction(): Promise<AppHealthSummary> {
  const services = getServices()
    .filter(
      (service) => service.name !== 'stackarr' && service.mode !== 'disabled' && service.experience !== 'infrastructure'
    )
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const checks = await Promise.all(services.map((service) => checkAppHealth(service.name, service.displayName)));
  appendMediaSearchRecoveryIssues(checks);

  return {
    checkedAt: new Date().toISOString(),
    checks,
    healthyCount: checks.filter((check) => check.status === 'healthy').length,
    issueCount: checks.reduce(
      (count, check) =>
        count + check.issues.length + (check.status === 'unavailable' && check.issues.length === 0 ? 1 : 0),
      0
    ),
    unavailableCount: checks.filter((check) => check.status === 'unavailable').length,
    unsupportedCount: checks.filter((check) => check.status === 'unsupported').length
  };
}

function appendMediaSearchRecoveryIssues(checks: AppHealthCheck[]) {
  const status = getMediaSearchReconciliationStatusAction();
  for (const [service, count] of Object.entries(status.exhaustedByInstance)) {
    if (!count) continue;
    const check = checks.find((item) => item.service === service);
    if (!check) continue;
    check.issues.push({
      severity: 'warning',
      source: 'Search recovery',
      message: `${count} recent monitored item${count === 1 ? '' : 's'} exhausted automatic search retries. Review the Wanted list.`
    });
    if (check.status === 'healthy') check.status = 'issues';
  }
}

async function checkAppHealth(service: string, displayName: string): Promise<AppHealthCheck> {
  const spec = healthChecks[service];
  if (!spec) return { service, displayName, status: 'unsupported', issues: [] };
  const baseUrl = maybeServiceBaseUrl(service);
  if (!baseUrl) return unavailable(service, displayName, 'HTTP endpoint is not configured.');
  const key = serviceApiKey(service);
  if (spec.credential && spec.credential !== 'optional-bearer' && !key) {
    return unavailable(service, displayName, 'API credential is not configured.');
  }

  try {
    const headers = healthHeaders(spec.credential, key);
    const rawUrl = `${baseUrl.replace(/\/$/, '')}${spec.path}`;
    const url = spec.credential === 'query' ? withQuery(rawUrl, { apikey: key }) : rawUrl;
    const response = await requestJson<unknown>(url, {
      method: spec.method,
      headers,
      body: spec.body,
      timeoutMs: 8_000
    });
    const issues = spec.issueArray ? normalizeIssueArray(response, key) : normalizeGenericHealth(response, key);
    return { service, displayName, status: issues.length ? 'issues' : 'healthy', issues };
  } catch (error) {
    if (error instanceof ServiceApiError && spec.reachableStatuses?.includes(error.status ?? 0)) {
      return { service, displayName, status: 'healthy', issues: [] };
    }
    return unavailable(service, displayName, safeMessage(error instanceof Error ? error.message : String(error), key));
  }
}

function unavailable(service: string, displayName: string, message: string): AppHealthCheck {
  return {
    service,
    displayName,
    status: 'unavailable',
    issues: [{ severity: 'error', source: 'Connectivity', message }]
  };
}

function normalizeIssueArray(value: unknown, key?: string): AppHealthIssue[] {
  if (!Array.isArray(value))
    return [{ severity: 'error', source: 'Health endpoint', message: 'Unexpected health response.' }];
  const seen = new Set<string>();
  const issues: AppHealthIssue[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = safeMessage(String(Reflect.get(item, 'source') ?? 'Application'), key);
    const message = safeMessage(String(Reflect.get(item, 'message') ?? 'Application reported a health issue.'), key);
    const severity = String(Reflect.get(item, 'type') ?? '').toLowerCase() === 'error' ? 'error' : 'warning';
    const signature = `${source}\u0000${message}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    issues.push({ severity, source, message });
  }
  return issues;
}

function normalizeGenericHealth(value: unknown, key?: string): AppHealthIssue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const status = String(record.status ?? record.health ?? '').toLowerCase();
  const healthy = record.healthy;
  const failed = healthy === false || ['error', 'failed', 'unhealthy', 'degraded'].includes(status);
  if (!failed) return [];
  return [
    {
      severity: status === 'degraded' ? 'warning' : 'error',
      source: 'Application',
      message: safeMessage(String(record.message ?? `Application reported ${status || 'an unhealthy state'}.`), key)
    }
  ];
}

function healthHeaders(credential: HealthCheckSpec['credential'], key?: string): Record<string, string> | undefined {
  if (!key || credential === 'query' || credential === 'optional-bearer') {
    return credential === 'optional-bearer' && key ? { authorization: `Bearer ${key}` } : undefined;
  }
  if (credential === 'api-key') return { 'X-Api-Key': key };
  if (credential === 'immich') return { 'x-api-key': key };
  if (credential === 'jellyfin') return { 'X-Emby-Token': key };
  if (credential === 'bearer') return { authorization: `Bearer ${key}` };
  return undefined;
}

function safeMessage(message: string, key?: string) {
  const withoutKnownKey = key ? message.split(key).join('********') : message;
  const withoutUrls = withoutKnownKey.replace(/https?:\/\/[^\s)\]}>,]+/gi, '[redacted URL]');
  return redactSecrets(withoutUrls).slice(0, 400);
}
