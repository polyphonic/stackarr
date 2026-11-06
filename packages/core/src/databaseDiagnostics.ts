import { spawn } from 'node:child_process';
import { databaseDeploymentMode } from './databaseEndpoints';
import type { StackarrEnv } from './env';

const maxDatabases = 32;
const maxExtensions = 128;
const deadlineMs = 8000;
const concurrency = 4;
const settingNames = [
  'shared_preload_libraries',
  'max_connections',
  'work_mem',
  'maintenance_work_mem',
  'max_wal_size'
] as const;
type State = 'ok' | 'unreachable' | 'insufficient_permission' | 'not_configured' | 'query_failed';
type Credential = { host: string; port: string; user: string; password: string; database: string; sslmode?: string };
type Target = { app: string; database: string; credential: Credential | null; required: string[] };
export type ExtensionInventory = {
  name: string;
  installedVersion: string | null;
  availableVersion: string | null;
  required: boolean;
};
export type DatabaseInspection = {
  app: string;
  database: string;
  endpoint: string;
  role: string;
  state: State;
  extensions: ExtensionInventory[];
  truncated: boolean;
};
export type DatabaseDiagnostics = {
  mode: 'managed' | 'external';
  ownership: 'Stackarr-managed container' | 'External server (read-only; owner-managed)';
  state: State;
  engine: string | null;
  version: string | null;
  settings: Array<{ name: string; value: string; pendingRestart: boolean }>;
  settingsState: State;
  restrictedSettings: string[];
  databases: DatabaseInspection[];
  omittedDatabases: boolean;
};
type Query = (credential: Credential, sql: string, signal?: AbortSignal) => Promise<string>;

// Fixed queries only: no user-provided SQL, identifiers, or connection URLs enter the command line.
const engineSql = "SELECT json_build_object('engine','PostgreSQL','version',current_setting('server_version'))::text";
const settingsSql = `SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)::text FROM (
  SELECT name, setting AS value, pending_restart AS "pendingRestart" FROM pg_settings
  WHERE name IN ('shared_preload_libraries','max_connections','work_mem','maintenance_work_mem','max_wal_size')
  ORDER BY name LIMIT 5) s`;
const extensionsSql = `SELECT coalesce(json_agg(row_to_json(e)), '[]'::json)::text FROM (
  SELECT coalesce(a.name, x.extname) AS name, x.extversion AS "installedVersion", a.default_version AS "availableVersion"
  FROM pg_available_extensions a FULL JOIN pg_extension x ON x.extname = a.name
  ORDER BY (x.extname IS NULL), name LIMIT 129) e`;

function classify(error: unknown): State {
  const text = String(error instanceof Error ? error.message : error);
  if (/permission denied|must be (a )?superuser|42501/i.test(text)) return 'insufficient_permission';
  if (/connect|timeout|refused|resolve|authentication|password|does not exist|no such file|ENOENT/i.test(text))
    return 'unreachable';
  return 'query_failed';
}

export async function psqlDiagnosticsQuery(credential: Credential, sql: string, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('connection timeout'));
      return;
    }
    // libpq treats a plain -d value as conninfo when it contains '=' or has a URI prefix.
    const dbname = `dbname='${credential.database.replace(/['\\]/g, '\\$&')}'`;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
    const child = spawn(
      'psql',
      [
        '-X',
        '-w',
        '-q',
        '-tA',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        credential.host,
        '-p',
        credential.port,
        '-U',
        credential.user,
        '-d',
        dbname
      ],
      {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...env,
          PGPASSWORD: credential.password,
          PGSSLMODE: credential.sslmode || 'disable',
          PGCONNECT_TIMEOUT: '3',
          PGOPTIONS:
            '-c default_transaction_read_only=on -c statement_timeout=4000 -c application_name=stackarr_diagnostics'
        }
      }
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let exceeded = false;
    let settled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let reap: ReturnType<typeof setTimeout> | undefined;
    const stop = (timeout = true) => {
      if (timeout) timedOut = true;
      child.kill('SIGTERM');
      escalation ??= setTimeout(() => {
        child.kill('SIGKILL');
        reap = setTimeout(() => finish(new Error(timedOut ? 'connection timeout' : 'query failed')), 500);
      }, 500);
    };
    const timer = setTimeout(stop, 5000);
    const abort = () => stop();
    signal?.addEventListener('abort', abort, { once: true });
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      if (reap) clearTimeout(reap);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(stdout.trim());
    }
    child.stdin.on('error', () => {
      /* The spawn error/close handler reports unavailable client. */
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (part: string) => {
      stdout += part.slice(0, Math.max(0, 131073 - stdout.length));
      if (stdout.length > 131072) {
        exceeded = true;
        stop(false);
      }
    });
    child.stderr.on('data', (part: string) => {
      stderr += part.slice(0, Math.max(0, 4097 - stderr.length));
      if (stderr.length > 4096) {
        exceeded = true;
        stop(false);
      }
    });
    child.on('error', () => finish(new Error('connection failed')));
    child.on('close', (code) => {
      // stderr may include endpoint or credentials: never propagate it to the API.
      if (code !== 0 || exceeded || timedOut)
        finish(
          new Error(
            timedOut
              ? 'connection timeout'
              : exceeded
                ? 'query failed'
                : /authentication failed|password authentication|refused|timeout|resolve|does not exist|could not connect|ENOENT/i.test(
                      stderr
                    )
                  ? 'connection failed'
                  : /permission denied|must be superuser/i.test(stderr)
                    ? 'permission denied'
                    : 'query failed'
          )
        );
      else finish();
    });
    child.stdin.end(sql);
  });
}

function fromUrl(raw: string): Credential | null {
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) return null;
    return {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      sslmode: url.searchParams.get('sslmode') || 'disable'
    };
  } catch {
    return null;
  }
}

function targets(env: StackarrEnv, mode: 'managed' | 'external'): Target[] {
  const host = mode === 'managed' ? 'database' : env.POSTGRES_HOST || '';
  const port = mode === 'managed' ? '5432' : env.POSTGRES_PORT || '';
  const result: Target[] = [];
  function add(
    app: string,
    database: string | undefined,
    user: string | undefined,
    password: string | undefined,
    required: string[] = [],
    prefix?: string
  ) {
    const endpointHost =
      mode === 'managed'
        ? host
        : (prefix && env[prefix === 'IMMICH_DB' ? 'IMMICH_DB_HOSTNAME' : `${prefix}_HOST`]) || host;
    const endpointPort = mode === 'managed' ? port : (prefix && env[`${prefix}_PORT`]) || port;
    if (
      !database ||
      !user ||
      !password ||
      !endpointHost ||
      !endpointPort ||
      !/^[1-9]\d{0,4}$/.test(endpointPort) ||
      Number(endpointPort) > 65535
    ) {
      result.push({ app, database: database || '', credential: null, required });
      return;
    }
    result.push({
      app,
      database,
      credential: { host: endpointHost, port: endpointPort, user, password, database, sslmode: 'disable' },
      required
    });
  }
  function enabled(key: string, fallback = false) {
    return ['true', '1', 'yes', 'on'].includes((env[key] ?? String(fallback)).toLowerCase());
  }
  function arr(prefix: string, flag: string, fallback = false) {
    if (!enabled(flag, fallback)) return;
    const user = env[`${prefix}_POSTGRES_USER`];
    const password = env[`${prefix}_POSTGRES_PASSWORD`];
    add(prefix, env[`${prefix}_POSTGRES_MAIN_DATABASE`], user, password, [], `${prefix}_POSTGRES`);
    add(`${prefix} log`, env[`${prefix}_POSTGRES_LOG_DATABASE`], user, password, [], `${prefix}_POSTGRES`);
  }
  if (env.STACKARR_DATABASE_MODE === 'postgres') {
    add(
      'Stackarr',
      env.STACKARR_POSTGRES_MAIN_DATABASE || env.STACKARR_POSTGRES_DATABASE,
      env.STACKARR_POSTGRES_USER,
      env.STACKARR_POSTGRES_PASSWORD
    );
    add('Stackarr log', env.STACKARR_POSTGRES_LOG_DATABASE, env.STACKARR_POSTGRES_USER, env.STACKARR_POSTGRES_PASSWORD);
    arr('PROWLARR', 'ENABLE_PROWLARR', true);
    arr('RADARR', 'ENABLE_MOVIES', true);
    arr('SONARR', 'ENABLE_TV_SHOWS', true);
    if (enabled('ENABLE_4K_SERVARR')) {
      arr('RADARR4K', 'ENABLE_MOVIES', true);
      arr('SONARR4K', 'ENABLE_TV_SHOWS', true);
    }
    arr('LIDARR', 'ENABLE_LIDARR', true);
    if (enabled('ENABLE_BAZARR', true))
      add(
        'BAZARR',
        env.BAZARR_POSTGRES_DATABASE,
        env.BAZARR_POSTGRES_USER,
        env.BAZARR_POSTGRES_PASSWORD,
        [],
        'BAZARR_POSTGRES'
      );
  }
  if (enabled('ENABLE_BOOKORBIT'))
    add('BOOKORBIT', env.BOOKORBIT_POSTGRES_DATABASE, env.BOOKORBIT_POSTGRES_USER, env.BOOKORBIT_POSTGRES_PASSWORD, [
      'uuid-ossp',
      'pg_trgm',
      'vector'
    ]);
  if (enabled('ENABLE_IMMICH')) {
    const choice = (env.IMMICH_DB_VECTOR_EXTENSION || 'pgvector').toLowerCase();
    const required = ['vchord', 'vectorchord'].includes(choice)
      ? ['cube', 'earthdistance', 'vector', 'vchord']
      : ['pgvector', 'vector', ''].includes(choice)
        ? ['cube', 'earthdistance', 'vector']
        : /^[a-z][a-z0-9_]{0,62}$/.test(choice)
          ? [choice]
          : [];
    add('IMMICH', env.IMMICH_DB_DATABASE_NAME, env.IMMICH_DB_USERNAME, env.IMMICH_DB_PASSWORD, required, 'IMMICH_DB');
  }
  if (enabled('ENABLE_TRACEARR'))
    add(
      'TRACEARR',
      env.TRACEARR_POSTGRES_DATABASE,
      env.TRACEARR_POSTGRES_USER,
      env.TRACEARR_POSTGRES_PASSWORD || env.TRACEARR_DB_PASSWORD,
      ['timescaledb']
    );
  if (enabled('ENABLE_ROMM')) add('ROMM', env.ROMM_DB_NAME, env.ROMM_DB_USER, env.ROMM_DB_PASSWORD, [], 'ROMM_DB');
  if (enabled('ENABLE_SEERR'))
    add('SEERR', env.SEERR_POSTGRES_DATABASE, env.SEERR_POSTGRES_USER, env.SEERR_POSTGRES_PASSWORD);
  if (enabled('ENABLE_PULSARR') && env.PULSARR_DB_TYPE === 'postgres')
    add(
      'PULSARR',
      env.PULSARR_POSTGRES_DATABASE || env.PULSARR_DB_NAME,
      env.PULSARR_POSTGRES_USER || env.PULSARR_DB_USER,
      env.PULSARR_POSTGRES_PASSWORD || env.PULSARR_DB_PASSWORD,
      [],
      'PULSARR_DB'
    );
  if (enabled('ENABLE_CLEANUPARR') && env.CLEANUPARR_DATABASE_PROVIDER === 'postgres')
    add(
      'CLEANUPARR',
      env.CLEANUPARR_POSTGRES_DATABASE,
      env.CLEANUPARR_POSTGRES_USER,
      env.CLEANUPARR_POSTGRES_PASSWORD,
      [],
      'CLEANUPARR_POSTGRES'
    );
  // Explicit URL credentials take precedence for configured URL-based clients.
  for (const [app, raw, required] of [
    ['Stackarr', env.STACKARR_DATABASE_URL, []],
    ['Stackarr log', env.STACKARR_LOG_DATABASE_URL, []],
    ['BOOKORBIT', env.BOOKORBIT_DATABASE_URL, ['uuid-ossp', 'pg_trgm', 'vector']],
    ['TRACEARR', env.TRACEARR_DATABASE_URL, ['timescaledb']]
  ] as Array<[string, string | undefined, string[]]>) {
    if (
      !raw ||
      (app === 'Stackarr' && env.STACKARR_DATABASE_MODE !== 'postgres') ||
      (app === 'Stackarr log' && env.STACKARR_DATABASE_MODE !== 'postgres') ||
      (app === 'BOOKORBIT' && !enabled('ENABLE_BOOKORBIT')) ||
      (app === 'TRACEARR' && !enabled('ENABLE_TRACEARR'))
    )
      continue;
    const credential = fromUrl(raw);
    const index = result.findIndex((item) => item.app === app);
    if (
      !credential ||
      !credential.database ||
      !credential.user ||
      !credential.password ||
      credential.password === '***'
    ) {
      const target: Target = { app, database: result[index]?.database || '', credential: null, required };
      if (index < 0) result.push(target);
      else result[index] = target;
      continue;
    }
    const target = { app, database: credential.database, credential, required };
    if (index < 0) result.push(target);
    else result[index] = target;
  }
  return result;
}

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9._+-]{1,64}$/.test(value) ? value : null;
}

/** Reads only configured app databases, never enumerates unrelated databases on an external server. */
export async function getDatabaseDiagnostics(
  env: StackarrEnv,
  query: Query = psqlDiagnosticsQuery
): Promise<DatabaseDiagnostics> {
  const mode = databaseDeploymentMode(env, 'POSTGRES');
  const all = targets(env, mode);
  const result: DatabaseDiagnostics = {
    mode,
    ownership: mode === 'managed' ? 'Stackarr-managed container' : 'External server (read-only; owner-managed)',
    state: 'not_configured',
    engine: null,
    version: null,
    settings: [],
    settingsState: 'not_configured',
    restrictedSettings: [],
    databases: [],
    omittedDatabases: all.length > maxDatabases
  };
  const selected = all.slice(0, maxDatabases);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let next = 0;
  let settingsAttempted = false;
  async function bounded(credential: Credential, sql: string) {
    if (controller.signal.aborted) throw new Error('connection timeout');
    return new Promise<string>((resolve, reject) => {
      const abort = () => reject(new Error('connection timeout'));
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => query(credential, sql, controller.signal))
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', abort));
    });
  }
  async function inspect(target: Target): Promise<DatabaseInspection> {
    const item: DatabaseInspection = {
      app: target.app,
      database: target.database,
      endpoint: target.credential ? `${target.credential.host}:${target.credential.port}` : '',
      role: target.credential?.user || '',
      state: target.credential ? 'ok' : 'not_configured',
      extensions: [],
      truncated: false
    };
    if (!target.credential) return item;
    try {
      const info = JSON.parse(await bounded(target.credential, engineSql)) as { engine: string; version: string };
      if (!result.version) {
        result.engine = info.engine === 'PostgreSQL' ? info.engine : null;
        result.version = /^\d+(?:\.\d+)*$/.test(info.version) ? info.version : null;
      }
      const raw = JSON.parse(await bounded(target.credential, extensionsSql)) as Array<{
        name: string;
        installedVersion: string | null;
        availableVersion: string | null;
      }>;
      item.truncated = raw.length > maxExtensions;
      const required = new Set(target.required);
      item.extensions = raw
        .slice(0, maxExtensions)
        .filter((e) => typeof e.name === 'string' && /^[a-z][a-z0-9_-]{0,62}$/.test(e.name))
        .map((e) => ({
          name: e.name,
          installedVersion: safeVersion(e.installedVersion),
          availableVersion: safeVersion(e.availableVersion),
          required: required.delete(e.name)
        }));
      for (const name of required)
        item.extensions.push({ name, installedVersion: null, availableVersion: null, required: true });
    } catch (error) {
      item.state = classify(error);
    }
    if (item.state === 'ok' && !settingsAttempted) {
      settingsAttempted = true;
      try {
        const settings = JSON.parse(await bounded(target.credential, settingsSql)) as DatabaseDiagnostics['settings'];
        if (!Array.isArray(settings)) throw new Error('invalid settings');
        result.settings = settings.filter(
          (s) =>
            settingNames.includes(s.name as (typeof settingNames)[number]) &&
            typeof s.value === 'string' &&
            s.value.length <= 512 &&
            typeof s.pendingRestart === 'boolean'
        );
        result.restrictedSettings = settingNames.filter((name) => !result.settings.some((s) => s.name === name));
        result.settingsState = result.restrictedSettings.length ? 'insufficient_permission' : 'ok';
      } catch (error) {
        result.settingsState = classify(error);
      }
    }
    return item;
  }
  const inspections: DatabaseInspection[] = selected.map((t) => ({
    app: t.app,
    database: t.database,
    endpoint: t.credential ? `${t.credential.host}:${t.credential.port}` : '',
    role: t.credential?.user || '',
    state: t.credential ? 'unreachable' : 'not_configured',
    extensions: [],
    truncated: false
  }));
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
        while (next < selected.length && !controller.signal.aborted) {
          const index = next++;
          inspections[index] = await inspect(selected[index]);
        }
      })
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  result.databases = inspections;
  result.state = result.databases.some((d) => d.state === 'ok') ? 'ok' : result.databases[0]?.state || 'not_configured';
  return result;
}
