'use strict';
// Live dependency evidence only. Never accepts a query, executable, endpoint or credentials from an approval lock.
const { spawn } = require('node:child_process');
const { mode } = require('./database-endpoints.cjs');
const MAX = 8192,
  TIMEOUT = 5000;
const ALIAS = { postgresql: 'database', redis: 'redis', mariadb: 'youtarr-db' };
const SELECTOR = {
  postgresql: ['postgres', 'POSTGRES', 'POSTGRES'],
  redis: ['redis', 'REDIS', 'REDIS'],
  mariadb: ['mariadb', 'YOUTARR_DATABASE', 'YOUTARR_DB']
};
const PG_SQL =
  "SELECT json_build_object('version', current_setting('server_version_num'), 'extensions', (SELECT coalesce(json_agg(json_build_object('name', extname, 'version', extversion) ORDER BY extname), '[]'::json) FROM (SELECT extname, extversion FROM pg_extension ORDER BY extname LIMIT 33) e))::text;";
const MARIA_SQL = 'SELECT VERSION();';

function productionRun({ command, args, env, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '',
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(new Error('Dependency client unavailable or query failed'));
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(true);
    }, TIMEOUT);
    child.on('error', () => finish(true));
    child.stdout.on('data', (part) => {
      output += part.toString('utf8');
      if (Buffer.byteLength(output) > MAX) {
        child.kill('SIGKILL');
        finish(true);
      }
    });
    child.on('close', (code) => finish(code !== 0, output));
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
function objectEnv(value) {
  if (Array.isArray(value)) {
    const result = {};
    for (const item of value) {
      const at = item.indexOf('=');
      if (at < 1 || Object.hasOwn(result, item.slice(0, at))) return null;
      result[item.slice(0, at)] = item.slice(at + 1);
    }
    return result;
  }
  return value && typeof value === 'object' ? value : null;
}
function port(value) {
  return /^(?:[1-9]\d{0,4})$/.test(String(value)) && Number(value) <= 65535;
}
function endpoint(host, number, selected, kind) {
  if (typeof host !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(host) || !port(number))
    throw Error('Invalid selected endpoint');
  if (
    selected === 'external' &&
    ['database', 'redis', 'youtarr-db', 'localhost', '127.0.0.1'].includes(host.toLowerCase())
  )
    throw Error('Retired managed endpoint');
  if (
    selected === 'managed' &&
    (host !== ALIAS[kind] || String(number) !== { postgresql: '5432', redis: '6379', mariadb: '3306' }[kind])
  )
    throw Error('Managed endpoint mismatch');
  return { host, port: String(number) };
}
function urlTarget(raw, kind) {
  const url = new URL(raw);
  if (
    !(kind === 'postgresql' ? ['postgres:', 'postgresql:'] : ['redis:', 'rediss:']).includes(url.protocol) ||
    url.searchParams.has('host') ||
    url.searchParams.has('service')
  )
    throw Error('Invalid connection URL');
  const defaultPort = kind === 'postgresql' ? '5432' : '6379';
  return {
    host: url.hostname,
    port: url.port || defaultPort,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    sslmode: url.searchParams.get('sslmode') || 'disable',
    tls: url.protocol === 'rediss:'
  };
}
function pgTargets(service, e) {
  if (['prowlarr', 'radarr', 'radarr4k', 'sonarr', 'sonarr4k', 'lidarr'].includes(service)) {
    const prefix = service.replace('4k', '');
    const key = prefix[0].toUpperCase() + prefix.slice(1);
    const base = `${key}__Postgres__`;
    return ['MainDb', 'LogDb'].map((db) => ({
      host: e[base + 'Host'],
      port: e[base + 'Port'],
      user: e[base + 'User'],
      password: e[base + 'Password'],
      database: e[base + db]
    }));
  }
  if (service === 'app') {
    if (e.STACKARR_DATABASE_MODE !== 'postgres') return [];
    return [e.STACKARR_DATABASE_URL, e.STACKARR_LOG_DATABASE_URL].map((raw) =>
      raw ? urlTarget(raw, 'postgresql') : null
    );
  }
  if (['tracearr', 'bookorbit'].includes(service)) return [urlTarget(e.DATABASE_URL, 'postgresql')];
  if (service === 'pulsarr')
    return e.dbType === 'postgres'
      ? [{ host: e.dbHost, port: e.dbPort, database: e.dbName, user: e.dbUser, password: e.dbPassword }]
      : [];
  if (service === 'romm')
    return e.ROMM_DB_DRIVER === 'postgresql'
      ? [{ host: e.DB_HOST, port: e.DB_PORT, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWD }]
      : [];
  if (service === 'immich')
    return [
      {
        host: e.DB_HOSTNAME,
        port: e.DB_PORT,
        database: e.DB_DATABASE_NAME,
        user: e.DB_USERNAME,
        password: e.DB_PASSWORD
      }
    ];
  if (service === 'seerr')
    return e.DB_TYPE === 'postgres'
      ? [{ host: e.DB_HOST, port: e.DB_PORT, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASS }]
      : [];
  if (service === 'cleanuparr')
    return e.DATABASE_PROVIDER === 'postgres'
      ? [
          {
            host: e.POSTGRES_HOST,
            port: e.POSTGRES_PORT,
            database: e.POSTGRES_DB,
            user: e.POSTGRES_USER,
            password: e.POSTGRES_PASS
          }
        ]
      : [];
  if (service === 'bazarr')
    return e.POSTGRES_ENABLED === 'true'
      ? [
          {
            host: e.POSTGRES_HOST,
            port: e.POSTGRES_PORT,
            database: e.POSTGRES_DATABASE,
            user: e.POSTGRES_USERNAME,
            password: e.POSTGRES_PASSWORD
          }
        ]
      : [];
  return null;
}
function redisTargets(service, e) {
  if (service === 'tracearr') return [urlTarget(e.REDIS_URL, 'redis')];
  if (service === 'romm') return [{ host: e.REDIS_HOST, port: e.REDIS_PORT }];
  if (service === 'immich') return [{ host: e.REDIS_HOSTNAME, port: e.REDIS_PORT }];
  return null;
}
function numericPg(value) {
  if (!/^\d{5,6}$/.test(value)) throw Error('Invalid server version');
  const n = Number(value),
    major = Math.floor(n / 10000),
    minor = Math.floor((n % 10000) / 100),
    patch = n % 100;
  if (major < 10) return `${major}.${minor}.${patch}`;
  return `${major}.${patch}`;
}
function safeVersion(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(value)) throw Error('Invalid server version');
  return value;
}
function cleanEnv(env) {
  const clean = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SYSTEMROOT'])
    if (typeof process.env[key] === 'string') clean[key] = process.env[key];
  return clean;
}
function dbname(value) {
  return `dbname='${value.replace(/[\\']/g, '\\$&')}'`;
}
async function query(run, kind, target, env) {
  const shared = cleanEnv(env);
  let command, args, input, childEnv;
  if (kind === 'postgresql') {
    command = 'psql';
    args = [
      '-X',
      '-w',
      '-q',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      target.host,
      '-p',
      target.port,
      '-U',
      target.user,
      '-d',
      dbname(target.database)
    ];
    input = PG_SQL;
    childEnv = {
      ...shared,
      PGPASSWORD: target.password,
      PGSSLMODE: target.sslmode,
      PGCONNECT_TIMEOUT: '3',
      PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=4000'
    };
  } else if (kind === 'mariadb') {
    command = 'mariadb';
    args = [
      '--no-defaults',
      '--protocol=tcp',
      '--batch',
      '--skip-column-names',
      '--connect-timeout=3',
      `--host=${target.host}`,
      `--port=${target.port}`,
      `--user=${target.user}`,
      `--database=${target.database}`
    ];
    input = MARIA_SQL;
    childEnv = { ...shared, MYSQL_PWD: target.password };
  } else {
    if (target.tls || target.user || target.password) throw Error('Unsupported Redis authentication');
    command = 'redis-cli';
    args = ['--raw', '-h', target.host, '-p', target.port, 'INFO', 'server'];
    input = '';
    childEnv = shared;
  }
  let timer;
  const raw = await Promise.race([
    Promise.resolve().then(() => run({ command, args, env: childEnv, input, timeoutMs: TIMEOUT, maxBytes: MAX })),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Dependency probe timeout')), TIMEOUT + 500);
    })
  ]).finally(() => clearTimeout(timer));
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX) throw Error('Invalid probe output');
  if (kind === 'postgresql') {
    const parsed = JSON.parse(raw.trim());
    if (
      !parsed ||
      typeof parsed.version !== 'string' ||
      !Array.isArray(parsed.extensions) ||
      parsed.extensions.length > 32
    )
      throw Error('Invalid extension inventory');
    const names = new Set();
    const extensions = parsed.extensions.map((ext) => {
      if (!ext || !/^[a-z][a-z0-9_]{0,63}$/.test(ext.name) || names.has(ext.name))
        throw Error('Invalid extension inventory');
      names.add(ext.name);
      return { name: ext.name, version: safeVersion(ext.version) };
    });
    return { version: numericPg(parsed.version), extensions };
  }
  if (kind === 'mariadb') {
    const maria = /^(\d+(?:\.\d+){1,3})-MariaDB(?:[-+][a-zA-Z0-9._-]{1,64})?$/i.exec(raw.trim());
    if (raw.trim().split('\n').length !== 1 || !maria) throw Error('Not a MariaDB server');
    return { version: safeVersion(maria[1]), extensions: [] };
  }
  const matches = [...raw.matchAll(/^redis_version:([^\r\n]+)\r?$/gm)];
  if (matches.length !== 1) throw Error('Invalid Redis INFO');
  return { version: safeVersion(matches[0][1]), extensions: [] };
}

/** Returns null on any uncertainty. Async: caller must await every required engine before policy evaluation. */
function createReadEngine({ compose, env = process.env, run = productionRun } = {}) {
  return async (engine, { service, project, daemonId } = {}) => {
    try {
      if (
        !Object.hasOwn(ALIAS, engine) ||
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(service || '') ||
        !project ||
        project !== env.COMPOSE_PROJECT_NAME ||
        (compose.name && compose.name !== project) ||
        !/^[a-zA-Z0-9_.:-]{1,128}$/.test(daemonId || '') ||
        !compose.services ||
        !Object.hasOwn(compose.services, service)
      )
        return null;
      const e = objectEnv(compose.services[service].environment);
      if (!e) return null;
      const [kind, , prefix] = SELECTOR[engine];
      const selected = mode(env, kind);
      const host = selected === 'managed' ? ALIAS[engine] : env[`${prefix}_HOST`];
      const number =
        selected === 'managed' ? { postgresql: '5432', redis: '6379', mariadb: '3306' }[engine] : env[`${prefix}_PORT`];
      const expected = endpoint(host, number, selected, engine);
      const targets =
        engine === 'postgresql'
          ? pgTargets(service, e)
          : engine === 'redis'
            ? redisTargets(service, e)
            : service === 'youtarr'
              ? [{ host: e.DB_HOST, port: e.DB_PORT, user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME }]
              : null;
      if (!targets || !targets.length || targets.length > 2 || targets.some((t) => !t)) return null;
      let version,
        extensions = [];
      for (const [index, target] of targets.entries()) {
        const actual = endpoint(target.host, target.port, selected, engine);
        if (actual.host !== expected.host || actual.port !== expected.port) return null;
        if (
          engine !== 'redis' &&
          (!/^[a-zA-Z0-9_-]{1,128}$/.test(target.user || '') ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(target.database || '') ||
            !target.password ||
            target.password === '***')
        )
          return null;
        const reading = await query(run, engine, target, env);
        if (version && version !== reading.version) return null;
        version = reading.version;
        if (index === 0) extensions = reading.extensions;
        else
          extensions = extensions.filter((item) =>
            reading.extensions.some((ext) => ext.name === item.name && ext.version === item.version)
          );
      }
      if (extensions.length > 32) return null;
      return { engine, version, extensions, attested: true };
    } catch {
      return null;
    } // Never reveal endpoints, client stderr, credentials or query text.
  };
}
// Conservative current-configuration lower bound, not a statement about a future image.
// null means unresolved binding: the gate must HOLD, including for requirements: [].
function requiredEnginesForService({ compose, env = process.env, service, project } = {}) {
  try {
    if (
      !compose?.services ||
      !Object.hasOwn(compose.services, service) ||
      !project ||
      project !== env.COMPOSE_PROJECT_NAME ||
      (compose.name && compose.name !== project)
    )
      return null;
    const e = objectEnv(compose.services[service].environment);
    if (!e) return null;
    for (const [kind] of Object.values(SELECTOR)) mode(env, kind);
    let pg,
      redis,
      maria = false;
    if (service === 'app')
      pg = e.STACKARR_DATABASE_MODE === 'postgres' ? true : e.STACKARR_DATABASE_MODE === 'app-default' ? false : null;
    else if (['tracearr', 'bookorbit', 'immich'].includes(service)) pg = true;
    else if (['prowlarr', 'radarr', 'radarr4k', 'sonarr', 'sonarr4k', 'lidarr'].includes(service)) {
      const targets = pgTargets(service, e);
      pg = targets.every((t) => !t.host && !t.port) ? false : true;
    } else if (service === 'pulsarr') pg = e.dbType === 'postgres' ? true : e.dbType === 'sqlite' ? false : null;
    else if (service === 'romm') pg = e.ROMM_DB_DRIVER === 'postgresql' ? true : null;
    else if (service === 'seerr') pg = e.DB_TYPE === 'postgres' ? true : null;
    else if (service === 'bazarr')
      pg = e.POSTGRES_ENABLED === 'true' ? true : e.POSTGRES_ENABLED === 'false' ? false : null;
    else if (service === 'cleanuparr') pg = e.DATABASE_PROVIDER === 'postgres' ? true : null;
    else if (service === 'youtarr') {
      pg = false;
      maria = true;
    } else return null;
    if (pg === null) return null;
    redis = ['tracearr', 'romm', 'immich'].includes(service);
    const engines = [...(pg ? ['postgresql'] : []), ...(redis ? ['redis'] : []), ...(maria ? ['mariadb'] : [])];
    // Resolve each configured endpoint from the same consumer environment that will be probed.
    for (const engine of engines) {
      const [kind, , prefix] = SELECTOR[engine];
      const selected = mode(env, kind);
      const expected = endpoint(
        selected === 'managed' ? ALIAS[engine] : env[`${prefix}_HOST`],
        selected === 'managed' ? { postgresql: '5432', redis: '6379', mariadb: '3306' }[engine] : env[`${prefix}_PORT`],
        selected,
        engine
      );
      const targets =
        engine === 'postgresql'
          ? pgTargets(service, e)
          : engine === 'redis'
            ? redisTargets(service, e)
            : [{ host: e.DB_HOST, port: e.DB_PORT, user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME }];
      if (
        !targets?.length ||
        targets.some(
          (t) =>
            !t ||
            !t.host ||
            !t.port ||
            t.host !== expected.host ||
            String(t.port) !== expected.port ||
            (engine !== 'redis' && (!t.database || !t.user || !t.password || t.password === '***'))
        )
      )
        return null;
    }
    return engines;
  } catch {
    return null;
  }
}
module.exports = { createReadEngine, requiredEnginesForService };
