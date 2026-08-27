import { requestJson, ServiceApiError, withQuery } from '../clients/http';
import { prowlarrGet } from '../clients/prowlarr';
import { seerrGet } from '../clients/seerr';
import { servarrGet } from '../clients/servarr';
import { type ArrInstance, maybeServiceBaseUrl, selectedDownloader, serviceApiKey } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { redactSecrets } from '../safety/redaction';
import { getServices } from '../services';
import { getMediaSearchReconciliationStatusAction } from './mediaReconciliation';
import { getPlexServerStatusAction } from './plex';
import { getServiceStatusAction } from './services';

export const diagnoseServiceAction = (input: { service: string }) => getServiceStatusAction(input);
export const testServiceApiAction = (input: { service: string }) => getServiceStatusAction(input);
export const testServiceConnectivityAction = (input: { service: string }) => getServiceStatusAction(input);
const arrServices: ArrInstance[] = ['radarr', 'radarr4k', 'sonarr', 'sonarr4k', 'lidarr'];
const databaseBackedServices = new Set([
  'prowlarr',
  'lidarr',
  'radarr',
  'radarr4k',
  'sonarr',
  'sonarr4k',
  'seerr',
  'pulsarr',
  'maintainerr',
  'bookorbit',
  'immich',
  'romm',
  'questarr',
  'youtarr',
  'bazarr',
  'tracearr'
]);

type DiagnosticResult = {
  service: string;
  status: 'passed' | 'failed' | 'notConfigured';
  message: string;
};

function enabledArrServices() {
  const enabled = new Set(
    getServices()
      .filter((service) => service.mode !== 'disabled')
      .map((service) => service.name)
  );
  return arrServices.filter((service) => enabled.has(service));
}

function diagnosticError(service: string, error: unknown): DiagnosticResult {
  return {
    service,
    status: 'failed',
    message: safeMessage(error instanceof Error ? error.message : String(error))
  };
}

function values(record: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => record[key]).filter((value): value is string => typeof value === 'string');
}

function matchingArrTargets(value: string) {
  const candidate = value.toLowerCase();
  return arrServices.filter((service) => {
    const base = service.replace('4k', '');
    return service.endsWith('4k')
      ? candidate.includes(service) || candidate.includes(`${base} 4k`)
      : candidate.includes(base) && !candidate.includes(`${base}4k`) && !candidate.includes(`${base} 4k`);
  });
}

function configuredArrTarget(record: Record<string, unknown>) {
  return matchingArrTargets(values(record, ['name', 'implementation', 'syncLevel', 'url', 'baseUrl']).join(' '))[0];
}

function summarizeDiagnostics(kind: string, results: DiagnosticResult[], extra: Record<string, unknown> = {}) {
  const failed = results.filter((result) => result.status === 'failed').length;
  const notConfigured = results.filter((result) => result.status === 'notConfigured').length;
  return {
    kind,
    status: failed ? 'issues' : notConfigured ? 'notConfigured' : 'healthy',
    checked: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed,
    notConfigured,
    results,
    note: 'Read-only diagnostic; no service configuration was changed.',
    ...extra
  };
}

/** Read each Arr download-client configuration without invoking its test or save endpoints. */
export async function testArrToDownloaderAction() {
  const downloader = selectedDownloader();
  const expected = downloader === 'qbittorrent' ? 'qbittorrent' : 'transmission';
  const results = await Promise.all(
    enabledArrServices().map(async (service): Promise<DiagnosticResult> => {
      try {
        const clients = await servarrGet<Array<Record<string, unknown>>>(
          service,
          'downloadclient',
          {},
          service === 'lidarr' ? 'v1' : 'v3'
        );
        const configured = clients.some((client) => {
          const implementation = values(client, ['implementation', 'name']).join(' ').toLowerCase();
          return client.enable !== false && implementation.includes(expected);
        });
        return {
          service,
          status: configured ? 'passed' : 'notConfigured',
          message: configured
            ? `Configured ${downloader} download client found.`
            : `No enabled ${downloader} download client found.`
        };
      } catch (error) {
        return diagnosticError(service, error);
      }
    })
  );
  return summarizeDiagnostics('arrToDownloader', results, { downloader });
}

/** Read Prowlarr application registrations; no indexer sync or configuration is triggered. */
export async function testProwlarrToArrAction() {
  try {
    const applications = await prowlarrGet<Array<Record<string, unknown>>>('applications');
    const configured = new Set(
      applications.map(configuredArrTarget).filter((service): service is ArrInstance => Boolean(service))
    );
    const results = enabledArrServices().map<DiagnosticResult>((service) => ({
      service,
      status: configured.has(service) ? 'passed' : 'notConfigured',
      message: configured.has(service)
        ? 'Prowlarr application registration found.'
        : 'No Prowlarr application registration found.'
    }));
    return summarizeDiagnostics('prowlarrToArr', results);
  } catch (error) {
    return summarizeDiagnostics('prowlarrToArr', [diagnosticError('prowlarr', error)]);
  }
}

function seerrArrTarget(family: 'radarr' | 'sonarr', record: Record<string, unknown>): ArrInstance {
  return record.is4k === true ? `${family}4k` : family;
}

/** Read Seerr's native Radarr/Sonarr settings; no requests, syncs, or configuration changes are triggered. */
export async function testSeerrToArrAction() {
  try {
    const targets = enabledArrServices().filter((service) => service !== 'lidarr');
    const families = [...new Set(targets.map((service) => (service.startsWith('radarr') ? 'radarr' : 'sonarr')))] as Array<
      'radarr' | 'sonarr'
    >;
    const registrations = await Promise.all(
      families.map(async (family) => ({
        family,
        records: await seerrGet<Array<Record<string, unknown>>>(`settings/${family}`)
      }))
    );
    const configured = new Set(
      registrations.flatMap(({ family, records }) => records.map((record) => seerrArrTarget(family, record)))
    );
    const results = targets.map<DiagnosticResult>((service) => ({
      service,
      status: configured.has(service) ? 'passed' : 'notConfigured',
      message: configured.has(service) ? 'Seerr service setting found.' : 'No Seerr service setting found.'
    }));
    return summarizeDiagnostics('seerrToArr', results);
  } catch (error) {
    return summarizeDiagnostics('seerrToArr', [diagnosticError('seerr', error)]);
  }
}
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
/**
 * Application health endpoints are the safe, credential-scoped way to check
 * their backing stores. This intentionally performs no direct database login,
 * migration, or write and returns only sanitized health diagnostics.
 */
export async function checkServiceDatabasesAction() {
  const summary = await getAppHealthSummaryAction();
  const checks = summary.checks
    .filter((check) => databaseBackedServices.has(check.service))
    .map((check) => ({
      service: check.service,
      status: check.status,
      issues: check.issues
    }));
  return {
    checkedAt: summary.checkedAt,
    status: checks.some((check) => check.status === 'unavailable')
      ? 'issues'
      : checks.some((check) => check.status === 'issues')
        ? 'issues'
        : 'healthy',
    checked: checks.length,
    healthy: checks.filter((check) => check.status === 'healthy').length,
    checks,
    note: 'Read-only application health checks; no database connections or service configuration were changed.'
  };
}
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
  allowTextResponse?: boolean;
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
  romm: { path: '/api/heartbeat', credential: 'optional-bearer', allowTextResponse: true },
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
      timeoutMs: 8_000,
      allowTextResponse: spec.allowTextResponse
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
