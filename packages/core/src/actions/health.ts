import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requestJson, ServiceApiError, withQuery } from '../clients/http';
import { prowlarrGet } from '../clients/prowlarr';
import { seerrGet } from '../clients/seerr';
import { servarrGet } from '../clients/servarr';
import { type ArrInstance, maybeServiceBaseUrl, selectedDownloader, serviceApiKey } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { redactSecrets } from '../safety/redaction';
import { getServices } from '../services';
import { readTasks } from '../tasks';
import { listBackupsAction } from './backups';
import { type DockerContainerOverview, getDockerContainerOverviewAction } from './containers';
import { getDownloadQueueAction, getTransmissionSessionStatus } from './downloads';
import { getMediaSearchReconciliationStatusAction } from './mediaReconciliation';
import { getPlexLibrariesAction, getPlexServerStatusAction } from './plex';
import { questarrRequest } from './questarr';
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
  'tdarr',
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
    const families = [
      ...new Set(targets.map((service) => (service.startsWith('radarr') ? 'radarr' : 'sonarr')))
    ] as Array<'radarr' | 'sonarr'>;
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
export async function getCommonIssuesAction() {
  const report = await getHealthReportAction();
  return {
    checkedAt: report.checkedAt,
    issues: report.findings,
    note: 'Current unresolved observations, not a static troubleshooting catalog. Read-only; no fixes applied.'
  };
}
export const applySafeFixAction = (input: { fixId: 'refresh-status-cache' | 'none' }) => ({
  fixId: input.fixId,
  applied: false,
  note: 'No safe automated fix is implemented for this ID. Nothing was changed; inspect the health report before a scoped repair.'
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

export type HealthFinding = {
  source: 'application' | 'task' | 'downloader' | 'container' | 'backup';
  service: string;
  status: 'warning' | 'error';
  message: string;
};

/** Only Stackarr's Compose project is authoritative; never match unrelated same-named containers. */
export function containerHealthFindings(
  services: ReturnType<typeof getServices>,
  overview: DockerContainerOverview,
  composeProject = 'stackarr'
): HealthFinding[] {
  if (!overview.dockerAvailable) {
    return [
      {
        source: 'container',
        service: 'docker',
        status: 'error',
        message: 'Docker inventory unavailable; expected containers could not be checked.'
      }
    ];
  }
  return services
    .filter((service) => service.mode === 'docker' && service.dockerService)
    .flatMap((service) => {
      const containers = overview.containers.filter(
        (container) => container.composeProject === composeProject && container.composeService === service.dockerService
      );
      if (!containers.length)
        return [
          {
            source: 'container' as const,
            service: service.name,
            status: 'error' as const,
            message: 'Enabled Docker container is absent.'
          }
        ];
      return containers.flatMap((container): HealthFinding[] => {
        const findings: HealthFinding[] = [];
        if (!container.running)
          findings.push({
            source: 'container',
            service: service.name,
            status: 'error',
            message: 'Enabled Docker container is not running.'
          });
        if (/\(unhealthy\)/i.test(container.status))
          findings.push({
            source: 'container',
            service: service.name,
            status: 'error',
            message: 'Docker healthcheck is unhealthy.'
          });
        if (container.restartPolicy === 'no' || !container.restartPolicy)
          findings.push({
            source: 'container',
            service: service.name,
            status: 'warning',
            message: 'Docker restart policy is not configured.'
          });
        return findings;
      });
    });
}

/** Bounded, secret-safe overview; login checks create only ephemeral service sessions. */
export async function getHealthReportAction() {
  const checkedAt = new Date().toISOString();
  const services = getServices();
  const [apps, docker, downloaderResult, backupResult] = await Promise.all([
    getAppHealthSummaryAction().catch(() => null),
    getDockerContainerOverviewAction(),
    getDownloadQueueAction({ downloader: selectedDownloader() }).then(
      () => true,
      () => false
    ),
    listBackupsAction()
      .then(async ({ root, backups }) => {
        const archives = backups.filter((name) => /\.(?:tar\.gz|tgz)(?:\.enc)?$|\.zip$/i.test(name));
        const stats = await Promise.all(
          archives.map(async (name) => {
            try {
              const stat = await fs.stat(path.join(root, name));
              return stat.isFile() ? stat.mtimeMs : 0;
            } catch {
              return 0;
            }
          })
        );
        return stats.length ? Math.max(...stats) : 0;
      })
      .catch(() => null)
  ]);
  const findings: HealthFinding[] = [];
  if (!apps)
    findings.push({
      source: 'application',
      service: 'stackarr',
      status: 'error',
      message: 'Application health inventory could not be completed.'
    });
  else
    for (const check of apps.checks) {
      if (check.status === 'healthy' || check.status === 'unsupported') continue;
      findings.push({
        source: 'application',
        service: check.service,
        status: check.status === 'unavailable' ? 'error' : 'warning',
        message: check.issues.length
          ? check.issues
              .map((issue) => safeMessage(issue.message))
              .join('; ')
              .slice(0, 400)
          : `Application health is ${check.status}.`
      });
    }
  findings.push(...containerHealthFindings(services, docker, readEnv().STACKARR_COMPOSE_PROJECT_NAME || 'stackarr'));
  const tasks = readTasks().filter(
    (task) => !task.reviewedAt && (task.status === 'failed' || task.status === 'blocked')
  );
  for (const task of tasks.slice(-20))
    findings.push({
      source: 'task',
      service: 'stackarr',
      status: 'error',
      message: `Unreviewed ${task.status} task: ${safeMessage(task.commandLabel)} (${task.id}).`
    });
  if (!downloaderResult)
    findings.push({
      source: 'downloader',
      service: selectedDownloader(),
      status: 'error',
      message: 'Authenticated selected-downloader queue request failed.'
    });
  if (backupResult === null)
    findings.push({
      source: 'backup',
      service: 'stackarr',
      status: 'warning',
      message: 'Backup archive metadata could not be checked.'
    });
  else if (!backupResult)
    findings.push({ source: 'backup', service: 'stackarr', status: 'warning', message: 'No backup archive found.' });
  else if (Date.now() - backupResult > 8 * 24 * 60 * 60 * 1000)
    findings.push({
      source: 'backup',
      service: 'stackarr',
      status: 'warning',
      message: 'Newest backup archive is older than eight days.'
    });
  return {
    checkedAt,
    status: findings.length ? ('issues' as const) : ('healthy' as const),
    findings,
    checks: {
      applications: apps?.checks.length ?? 0,
      authenticationUnverified:
        apps?.checks
          .filter((check) => check.authentication === 'notConfigured' || check.authentication === 'unsupported')
          .map((check) => check.service) ?? [],
      dockerAvailable: docker.dockerAvailable,
      downloader: selectedDownloader(),
      unreviewedFailedOrBlockedTasks: tasks.length,
      newestBackupAt: backupResult ? new Date(backupResult).toISOString() : null
    },
    scope: {
      portlessHost: 'unsupported: host Portless routing is not checked from the Stackarr container',
      note: 'No service configuration was changed. Authenticated probes may create short-lived login sessions; no host routing or filesystem integrity check was performed.'
    }
  };
}

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
  /** HTTP availability and credential verification are deliberately separate. */
  availability?: 'reachable' | 'unavailable' | 'unknown';
  authentication?: 'verified' | 'failed' | 'notConfigured' | 'unsupported';
  /** What was actually proved; availability must not be presented as runtime or auth health. */
  scope?: 'authenticated' | 'application' | 'availability' | 'cli' | 'container';
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
  tdarr: { path: '/api/v2/status', credential: 'api-key' },
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
  // Login-backed services are handled separately; their public/challenged routes are not auth checks.
  cleanuparr: { path: '/api/health' },
  homeassistant: { path: '/api/' },
  frigate: { path: '/api/version' }
};

/** Explicit registry for every app/helper. New services must select a real probe, never inherit healthy. */
export const appHealthProbes = {
  agregarr: 'http',
  bazarr: 'http',
  bookorbit: 'http',
  cleanuparr: 'login',
  flaresolverr: 'http',
  frigate: 'login',
  homeassistant: 'login',
  immich: 'http',
  jellyfin: 'http',
  lidarr: 'http',
  maintainerr: 'http',
  plex: 'plex',
  prowlarr: 'http',
  pulsarr: 'http',
  qbittorrent: 'downloader',
  questarr: 'questarr',
  radarr: 'http',
  radarr4k: 'http',
  recyclarr: 'container',
  romm: 'http',
  seerr: 'http',
  sonarr: 'http',
  sonarr4k: 'http',
  streamrip: 'cli',
  tdarr: 'http',
  tidarr: 'availability',
  tinymediamanager: 'availability',
  tracearr: 'http',
  transmission: 'downloader',
  youtarr: 'http'
} as const satisfies Record<string, string>;

function probeFailure(service: string, displayName: string, scope: AppHealthCheck['scope']): AppHealthCheck {
  // Native clients may include response bodies or credentials in errors. Never echo them.
  return { ...unavailable(service, displayName, `${displayName} ${scope} probe failed.`), scope };
}

async function checkSpecialHealth(service: string, displayName: string, kind: string): Promise<AppHealthCheck> {
  let scope: AppHealthCheck['scope'] =
    kind === 'container'
      ? 'container'
      : kind === 'cli'
        ? 'cli'
        : kind === 'availability'
          ? 'availability'
          : 'authenticated';
  try {
    if (kind === 'plex') {
      if (!serviceApiKey('plex'))
        return {
          service,
          displayName,
          status: 'unsupported',
          issues: [],
          authentication: 'notConfigured',
          scope: 'availability'
        };
      // /identity is public. Use the protected library endpoint to verify the token.
      const result = await bounded(getPlexLibrariesAction(), 8_000);
      if (!result || typeof result !== 'object' || !('MediaContainer' in result))
        throw new Error('Invalid Plex library response');
    } else if (kind === 'downloader') {
      const env = readEnv();
      const username =
        service === 'transmission'
          ? env.TRANSMISSION_USERNAME || env.USERNAME
          : env.QBITTORRENT_USERNAME || env.USERNAME;
      const password =
        service === 'transmission'
          ? env.TRANSMISSION_PASSWORD || env.PASSWORD
          : env.QBITTORRENT_PASSWORD || env.PASSWORD;
      if (!username || !password) scope = 'application';
      if (service === 'transmission') await getTransmissionSessionStatus();
      else await bounded(getDownloadQueueAction({ downloader: 'qbittorrent' }), 8_000);
    } else if (kind === 'questarr') {
      const base = maybeServiceBaseUrl(service);
      if (!base) return unavailable(service, displayName, 'HTTP endpoint is not configured.');
      const result = await bounded(questarrRequest<unknown>(`${base}/api/downloads`), 8_000);
      if (!result || typeof result !== 'object') throw new Error('Invalid Questarr response');
    } else if (kind === 'cli') {
      await probeCli(readEnv().STREAMRIP_COMMAND?.trim() || process.env.STREAMRIP_COMMAND?.trim() || 'rip', [
        '--version'
      ]);
    } else if (kind === 'container') {
      const overview = await getDockerContainerOverviewAction();
      if (!overview.dockerAvailable) return probeFailure(service, displayName, scope);
      const project = readEnv().COMPOSE_PROJECT_NAME || process.env.COMPOSE_PROJECT_NAME || 'stackarr';
      const container = overview.containers.find(
        (item) => item.composeProject === project && item.composeService === service
      );
      if (!container?.running || /\(unhealthy\)/i.test(container.status))
        return probeFailure(service, displayName, scope);
      // A running scheduler is not proof that its binary can execute. This never invokes sync.
      await probeCli('docker', ['exec', container.id, 'recyclarr', '--version']);
    } else if (kind === 'availability') {
      const base = maybeServiceBaseUrl(service);
      if (!base) return unavailable(service, displayName, 'HTTP endpoint is not configured.');
      const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(8_000), redirect: 'manual' });
      // Login challenges and redirects prove only that the UI is serving, not application health.
      if (!response.ok && ![301, 302, 303, 307, 308, 401, 403].includes(response.status))
        throw new Error('UI unavailable');
      await response.body?.cancel();
    }
    return {
      service,
      displayName,
      status: scope === 'availability' ? 'unsupported' : 'healthy',
      issues: [],
      scope,
      ...(scope === 'authenticated' ? { authentication: 'verified' as const } : {}),
      availability: 'reachable'
    };
  } catch {
    return probeFailure(service, displayName, scope);
  }
}

function bounded<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Probe timed out')), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function probeCli(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('CLI unavailable'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error('CLI exited unsuccessfully'));
    });
  });
}

function authCheck(
  service: string,
  displayName: string,
  authentication: AppHealthCheck['authentication'],
  availability: AppHealthCheck['availability'],
  message?: string
): AppHealthCheck {
  return {
    service,
    displayName,
    availability,
    authentication,
    scope: authentication === 'verified' ? 'authenticated' : 'availability',
    status: authentication === 'verified' ? 'healthy' : authentication === 'failed' ? 'issues' : 'unsupported',
    issues: message && authentication === 'failed' ? [{ severity: 'error', source: 'Authentication', message }] : []
  };
}

/** Never use the unauthenticated Frigate port. A fresh session cookie is kept only in memory. */
async function verifyFrigate(baseUrl: string, username: string, password: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: username, password }),
      signal: controller.signal
    });
    if (!login.ok) return false;
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie || !/^[a-zA-Z0-9_-]+=[^;]+$/.test(cookie)) return false;
    const profile = await fetch(`${baseUrl}/api/profile`, {
      headers: { cookie, accept: 'application/json' },
      signal: controller.signal
    });
    if (!profile.ok) return false;
    const identity: unknown = await profile.json();
    return Boolean(
      identity &&
        typeof identity === 'object' &&
        (identity as Record<string, unknown>).username === username &&
        (identity as Record<string, unknown>).role === 'admin'
    );
  } finally {
    clearTimeout(timeout);
  }
}

// Bound login attempts from frequently refreshed dashboards to avoid lockouts.
const loginCache = new Map<string, { fingerprint: string; expires: number; result: AppHealthCheck }>();

async function checkLoginBackedHealth(service: string, displayName: string, baseUrl: string): Promise<AppHealthCheck> {
  const env = readEnv();
  const username = env.USERNAME?.trim();
  const password = env.PASSWORD;
  // Provisioning owns token creation; health checks only use the saved credential.
  const key =
    service === 'homeassistant'
      ? env.HOMEASSISTANT_TOKEN?.trim() || serviceApiKey(service) || process.env.HOMEASSISTANT_TOKEN?.trim()
      : undefined;
  // An unauthenticated request is an availability probe, never evidence of a valid credential.
  try {
    await requestJson<unknown>(`${baseUrl}${healthChecks[service].path}`, { timeoutMs: 8_000 });
  } catch (error) {
    if (!(error instanceof ServiceApiError && [401, 403].includes(error.status ?? 0))) {
      return {
        ...unavailable(service, displayName, 'HTTP endpoint is unavailable.'),
        availability: 'unavailable',
        authentication: 'unsupported'
      };
    }
  }
  if (service === 'homeassistant') {
    if (!key) return authCheck(service, displayName, 'notConfigured', 'reachable');
    try {
      const result = await requestJson<unknown>(`${baseUrl}/api/`, {
        headers: { authorization: `Bearer ${key}` },
        timeoutMs: 8_000
      });
      // Home Assistant's authenticated API root returns { message: 'API running.' }.
      if (!result || typeof result !== 'object' || (result as Record<string, unknown>).message !== 'API running.')
        return authCheck(
          service,
          displayName,
          'failed',
          'reachable',
          'Authenticated API returned an unexpected response.'
        );
      return authCheck(service, displayName, 'verified', 'reachable');
    } catch {
      return authCheck(service, displayName, 'failed', 'reachable', 'Authenticated Home Assistant API request failed.');
    }
  }
  if (!username || !password) return authCheck(service, displayName, 'notConfigured', 'reachable');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([baseUrl, username, password]))
    .digest('hex');
  const cached = loginCache.get(service);
  if (cached?.fingerprint === fingerprint && cached.expires > Date.now()) return cached.result;
  try {
    let result: AppHealthCheck;
    if (service === 'frigate') {
      const valid = await verifyFrigate(baseUrl, username, password);
      result = authCheck(
        service,
        displayName,
        valid ? 'verified' : 'failed',
        'reachable',
        'Frigate login or admin profile verification failed.'
      );
    } else {
      const login = await requestJson<Record<string, unknown>>(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        body: { username, password },
        timeoutMs: 8_000
      });
      if (login.requiresTwoFactor) return authCheck(service, displayName, 'unsupported', 'reachable');
      const tokens =
        login.tokens && typeof login.tokens === 'object' ? (login.tokens as Record<string, unknown>) : login;
      const token = tokens.accessToken;
      if (typeof token !== 'string' || !token) throw new Error('Invalid login response');
      // A login response alone is insufficient: verify the protected application route.
      await requestJson<unknown>(`${baseUrl}/api/health`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 8_000
      });
      result = authCheck(service, displayName, 'verified', 'reachable');
    }
    loginCache.set(service, { fingerprint, expires: Date.now() + 60_000, result });
    return result;
  } catch {
    const result = authCheck(
      service,
      displayName,
      'failed',
      'reachable',
      `${displayName} authenticated health check failed.`
    );
    loginCache.set(service, { fingerprint, expires: Date.now() + 60_000, result });
    return result;
  }
}

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

export async function checkAppHealth(service: string, displayName: string): Promise<AppHealthCheck> {
  const kind = appHealthProbes[service as keyof typeof appHealthProbes];
  if (kind && kind !== 'http' && kind !== 'login') {
    // qBittorrent and Questarr log in via their native clients; throttle bad credentials.
    if (service === 'qbittorrent' || service === 'questarr') {
      const env = readEnv();
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            maybeServiceBaseUrl(service),
            env.USERNAME,
            env.PASSWORD,
            service === 'qbittorrent' ? env.QBITTORRENT_PASSWORD : undefined
          ])
        )
        .digest('hex');
      const cached = loginCache.get(service);
      if (cached?.fingerprint === fingerprint && cached.expires > Date.now()) return cached.result;
      const result = await checkSpecialHealth(service, displayName, kind);
      loginCache.set(service, { fingerprint, expires: Date.now() + 60_000, result });
      return result;
    }
    return checkSpecialHealth(service, displayName, kind);
  }
  const spec = healthChecks[service];
  if (!spec) return { service, displayName, status: 'unsupported', issues: [] };
  const baseUrl = maybeServiceBaseUrl(service);
  if (!baseUrl) return unavailable(service, displayName, 'HTTP endpoint is not configured.');
  if (service === 'cleanuparr' || service === 'frigate' || service === 'homeassistant')
    return checkLoginBackedHealth(service, displayName, baseUrl.replace(/\/$/, ''));
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
    const issues = filterExpectedIssues(
      service,
      spec.issueArray ? normalizeIssueArray(response, key) : normalizeGenericHealth(response, key)
    );

    return {
      service,
      displayName,
      status: issues.length ? 'issues' : 'healthy',
      issues,
      scope: spec.credential && key ? 'authenticated' : 'application',
      availability: 'reachable',
      ...(spec.credential && key ? { authentication: 'verified' as const } : {})
    };
  } catch (error) {
    if (error instanceof ServiceApiError && spec.reachableStatuses?.includes(error.status ?? 0)) {
      return {
        service,
        displayName,
        status: 'issues',
        issues: [
          {
            severity: 'warning',
            source: 'Authentication',
            message: `HTTP ${error.status} confirms reachability only; authenticated application health was not verified.`
          }
        ]
      };
    }
    return unavailable(service, displayName, safeMessage(error instanceof Error ? error.message : String(error), key));
  }
}

function filterExpectedIssues(service: string, issues: AppHealthIssue[]) {
  if (service !== 'lidarr') return issues;

  return issues.filter(
    (issue) =>
      !(issue.source === 'ImportMechanismCheck' && issue.message === 'Enable Completed Download Handling') &&
      !(issue.source === 'MountCheck' && /artist path is mounted read-only/i.test(issue.message))
  );
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
