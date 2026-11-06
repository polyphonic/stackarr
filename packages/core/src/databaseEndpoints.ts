import type { StackarrEnv } from './env';

const prefixes = ['SEERR', 'CLEANUPARR', 'BAZARR', 'PROWLARR', 'RADARR', 'RADARR4K', 'SONARR', 'SONARR4K', 'LIDARR'];

export function databaseDeploymentMode(env: StackarrEnv, engine: 'POSTGRES' | 'REDIS' | 'YOUTARR_DATABASE') {
  const mode = env[`${engine}_DEPLOYMENT_MODE`] || 'managed';
  if (mode === 'managed') return 'managed';
  if (mode === 'external' || mode === 'independent') return 'external';
  throw new Error(`Invalid ${engine} deployment mode.`);
}

function endpoint(env: StackarrEnv, prefix: string) {
  const host = env[`${prefix}_HOST`];
  const port = env[`${prefix}_PORT`];
  if (
    !host ||
    !/^[a-z0-9.-]+$/i.test(host) ||
    !/^[1-9]\d{0,4}$/.test(port || '') ||
    Number(port) > 65535 ||
    ['localhost', '127.0.0.1', 'database', 'redis', 'youtarr-db'].includes(host.toLowerCase())
  )
    throw new Error(`Invalid ${prefix} external container endpoint.`);
  return { host, port };
}

function rewrite(
  value: string | undefined,
  oldHost: string,
  target: { host: string; port: string },
  key: string,
  protocols: string[]
) {
  if (!value) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${key} URL.`);
  }
  if (!protocols.includes(url.protocol)) throw new Error(`Invalid ${key} URL protocol.`);
  if (url.hostname !== oldHost && (url.hostname !== target.host || url.port !== target.port))
    throw new Error(`${key} targets a different endpoint; update it explicitly before changing deployment.`);
  if (url.hostname === oldHost) {
    url.hostname = target.host;
    url.port = target.port;
  }
  return url.toString();
}

function managed(
  env: StackarrEnv,
  engine: 'POSTGRES' | 'REDIS' | 'YOUTARR_DATABASE',
  selector: string,
  hostKeys: Array<[string, string]>,
  urlKeys: Array<[string, string, string[]]>
) {
  if (databaseDeploymentMode(env, engine) !== 'managed') return;
  const port = engine === 'POSTGRES' ? '5432' : engine === 'REDIS' ? '6379' : '3306';
  if (env[selector]) throw new Error(`Clear ${selector} and review client endpoints before using the managed engine.`);
  for (const [key, alias] of hostKeys) {
    if (env[key] && env[key] !== alias) throw new Error(`${key} must target ${alias} in managed mode.`);
    const portKey = key.replace(/_HOST(?:NAME)?$/, '_PORT');
    if (env[portKey] && env[portKey] !== port) throw new Error(`${portKey} must use port ${port} in managed mode.`);
  }
  for (const [key, alias, protocols] of urlKeys) {
    if (!env[key]) continue;
    let url: URL;
    try {
      url = new URL(env[key]);
    } catch {
      throw new Error(`Invalid ${key} URL.`);
    }
    if (!protocols.includes(url.protocol) || url.hostname !== alias)
      throw new Error(`${key} must target ${alias} in managed mode.`);
    if (url.port && url.port !== port) throw new Error(`${key} must use port ${port} in managed mode.`);
  }
}

/** Project endpoints onto participating clients; never move database files. */
export function projectDatabaseEndpoints(env: StackarrEnv): StackarrEnv {
  const projected = { ...env };
  const postgres = databaseDeploymentMode(env, 'POSTGRES');
  const redis = databaseDeploymentMode(env, 'REDIS');
  const mariadb = databaseDeploymentMode(env, 'YOUTARR_DATABASE');
  const pgHosts: Array<[string, string]> = [
    ...prefixes.map((prefix) => [`${prefix}_POSTGRES_HOST`, 'database'] as [string, string]),
    ['PULSARR_DB_HOST', 'database'],
    ['ROMM_DB_HOST', 'database'],
    ['IMMICH_DB_HOSTNAME', 'database']
  ];
  const pgUrls: Array<[string, string, string[]]> = [
    'STACKARR_DATABASE_URL',
    'STACKARR_LOG_DATABASE_URL',
    'BOOKORBIT_DATABASE_URL',
    'TRACEARR_DATABASE_URL'
  ].map((key) => [key, 'database', ['postgres:', 'postgresql:']]);
  managed(env, 'POSTGRES', 'POSTGRES_HOST', pgHosts, pgUrls);
  managed(
    env,
    'REDIS',
    'REDIS_HOST',
    [
      ['ROMM_REDIS_HOST', 'redis'],
      ['IMMICH_REDIS_HOST', 'redis']
    ],
    [['TRACEARR_REDIS_URL', 'redis', ['redis:', 'rediss:']]]
  );
  managed(env, 'YOUTARR_DATABASE', 'YOUTARR_DATABASE_HOST', [['YOUTARR_DB_HOST', 'youtarr-db']], []);
  if (env.PULSARR_DB_TYPE === 'postgres') {
    projected.PULSARR_DB_NAME = env.PULSARR_POSTGRES_DATABASE || env.PULSARR_DB_NAME || '';
    projected.PULSARR_DB_USER = env.PULSARR_POSTGRES_USER || env.PULSARR_DB_USER || '';
    projected.PULSARR_DB_PASSWORD = env.PULSARR_POSTGRES_PASSWORD || env.PULSARR_DB_PASSWORD || '';
  }
  if (postgres === 'external') {
    const target = endpoint(env, 'POSTGRES');
    for (const prefix of prefixes) {
      projected[`${prefix}_POSTGRES_HOST`] = target.host;
      projected[`${prefix}_POSTGRES_PORT`] = target.port;
    }
    for (const prefix of ['PULSARR_DB', 'ROMM_DB']) {
      projected[`${prefix}_HOST`] = target.host;
      projected[`${prefix}_PORT`] = target.port;
    }
    projected.IMMICH_DB_HOSTNAME = target.host;
    projected.IMMICH_DB_PORT = target.port;
    for (const key of [
      'STACKARR_DATABASE_URL',
      'STACKARR_LOG_DATABASE_URL',
      'BOOKORBIT_DATABASE_URL',
      'TRACEARR_DATABASE_URL'
    ])
      projected[key] = rewrite(env[key], 'database', target, key, ['postgres:', 'postgresql:']) || '';
    // Tracearr always requires PostgreSQL; reject a stale URL rather than silently routing it elsewhere.
    if (env.ENABLE_TRACEARR === 'true') {
      const url = new URL(projected.TRACEARR_DATABASE_URL);
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.hostname !== target.host ||
        url.port !== target.port
      )
        throw new Error('Tracearr URL must target the external PostgreSQL endpoint.');
    }
  }
  if (redis === 'external') {
    if (env.REDIS_USERNAME || env.REDIS_PASSWORD)
      throw new Error('Authenticated external Redis is not supported by all clients.');
    if (env.TRACEARR_REDIS_URL) {
      const url = new URL(env.TRACEARR_REDIS_URL);
      if (url.username || url.password)
        throw new Error('Authenticated external Redis is not supported by all clients.');
    }
    const target = endpoint(env, 'REDIS');
    for (const prefix of ['ROMM', 'IMMICH']) {
      projected[`${prefix}_REDIS_HOST`] = target.host;
      projected[`${prefix}_REDIS_PORT`] = target.port;
    }
    projected.TRACEARR_REDIS_URL =
      rewrite(env.TRACEARR_REDIS_URL || 'redis://redis:6379', 'redis', target, 'TRACEARR_REDIS_URL', ['redis:']) || '';
  }
  if (mariadb === 'external') {
    const target = endpoint(env, 'YOUTARR_DB');
    projected.YOUTARR_DB_HOST = target.host;
    projected.YOUTARR_DB_PORT = target.port;
  }
  return projected;
}
