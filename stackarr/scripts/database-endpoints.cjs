#!/usr/bin/env node
'use strict';
// Endpoint selection only. No engine installation, migration, or credential discovery.
const { URL } = require('node:url');
const engines = { postgres: ['POSTGRES', 'database'], redis: ['REDIS', 'redis'], mariadb: ['YOUTARR_DATABASE', 'youtarr-db'] };
function mode(env, engine) {
  const value = env[`${engines[engine][0]}_DEPLOYMENT_MODE`] || 'managed';
  if (value === 'managed') return 'managed';
  if (value === 'external' || value === 'independent') return 'external';
  throw Error(`Invalid ${engine} deployment mode`);
}
function endpoint(env, prefix, hostKey = 'HOST', portKey = 'PORT') {
  const host = env[`${prefix}_${hostKey}`], port = env[`${prefix}_${portKey}`];
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || !/^[1-9]\d{0,4}$/.test(port || '') || Number(port) > 65535 ||
      ['localhost', '127.0.0.1', 'database', 'redis', 'youtarr-db'].includes(host.toLowerCase()))
    throw Error(`Invalid ${prefix} external container endpoint`);
  return { host, port };
}
function rewrite(value, oldHost, target, key, protocols) {
  if (!value) return value;
  let url;
  try { url = new URL(value); } catch { throw Error(`Invalid ${key} URL`); }
  if (!protocols.includes(url.protocol)) throw Error(`Invalid ${key} URL protocol`);
  // An explicit URL is allowed only when it already names the selected endpoint.
  // Never reinterpret an old external URL as an instruction to migrate its data.
  if (url.hostname !== oldHost && (url.hostname !== target.host || url.port !== target.port))
    throw Error(`${key} targets a different endpoint; update it explicitly before changing deployment`);
  if (url.hostname === oldHost) {
    url.hostname = target.host;
    url.port = target.port;
  }
  return url.toString();
}
function managed(env, engine, selector, hostKeys, urlKeys) {
  if (mode(env, engine) !== 'managed') return;
  const port = engine === 'postgres' ? '5432' : engine === 'redis' ? '6379' : '3306';
  const former = env[selector];
  // A retained external selector is evidence of a half-completed cutover. Do
  // not start the bundled engine while clients may still target external data.
  if (former) throw Error(`Clear ${selector} and review client endpoints before using the managed engine`);
  for (const [key, alias] of hostKeys) {
    if (env[key] && env[key] !== alias) throw Error(`${key} must target ${alias} in managed mode`);
    const portKey = key.replace(/_HOST(?:NAME)?$/, '_PORT');
    if (env[portKey] && env[portKey] !== port) throw Error(`${portKey} must use port ${port} in managed mode`);
  }
  for (const [key, alias, protocols] of urlKeys) {
    if (!env[key]) continue;
    let url;
    try { url = new URL(env[key]); } catch { throw Error(`Invalid ${key} URL`); }
    if (!protocols.includes(url.protocol) || url.hostname !== alias)
      throw Error(`${key} must target ${alias} in managed mode`);
    if (url.port && url.port !== port) throw Error(`${key} must use port ${port} in managed mode`);
  }
}
function project(env) {
  const result = { ...env };
  for (const engine of Object.keys(engines)) mode(env, engine);
  const pgPrefixes = ['SEERR', 'CLEANUPARR', 'BAZARR', 'PROWLARR', 'RADARR', 'RADARR4K', 'SONARR', 'SONARR4K', 'LIDARR'];
  const pgHosts = [
    ...pgPrefixes.map(prefix => [`${prefix}_POSTGRES_HOST`, 'database']),
    ['PULSARR_DB_HOST', 'database'], ['ROMM_DB_HOST', 'database'], ['IMMICH_DB_HOSTNAME', 'database']
  ];
  const pgUrls = ['STACKARR_DATABASE_URL', 'STACKARR_LOG_DATABASE_URL', 'BOOKORBIT_DATABASE_URL', 'TRACEARR_DATABASE_URL']
    .map(key => [key, 'database', ['postgres:', 'postgresql:']]);
  managed(env, 'postgres', 'POSTGRES_HOST', pgHosts, pgUrls);
  managed(env, 'redis', 'REDIS_HOST', [['ROMM_REDIS_HOST', 'redis'], ['IMMICH_REDIS_HOST', 'redis']],
    [['TRACEARR_REDIS_URL', 'redis', ['redis:', 'rediss:']]]);
  managed(env, 'mariadb', 'YOUTARR_DATABASE_HOST', [['YOUTARR_DB_HOST', 'youtarr-db']], []);
  if (env.PULSARR_DB_TYPE === 'postgres') {
    result.PULSARR_DB_NAME = env.PULSARR_POSTGRES_DATABASE || env.PULSARR_DB_NAME;
    result.PULSARR_DB_USER = env.PULSARR_POSTGRES_USER || env.PULSARR_DB_USER;
    result.PULSARR_DB_PASSWORD = env.PULSARR_POSTGRES_PASSWORD || env.PULSARR_DB_PASSWORD;
  }
  if (mode(env, 'postgres') === 'external') {
    const target = endpoint(env, 'POSTGRES');
    for (const prefix of ['SEERR', 'CLEANUPARR', 'BAZARR', 'PROWLARR', 'RADARR', 'RADARR4K', 'SONARR', 'SONARR4K', 'LIDARR']) {
      result[`${prefix}_POSTGRES_HOST`] = target.host;
      result[`${prefix}_POSTGRES_PORT`] = target.port;
    }
    for (const prefix of ['PULSARR_DB', 'ROMM_DB']) {
      result[`${prefix}_HOST`] = target.host;
      result[`${prefix}_PORT`] = target.port;
    }
    result.IMMICH_DB_HOSTNAME = target.host;
    result.IMMICH_DB_PORT = target.port;
    for (const key of ['STACKARR_DATABASE_URL', 'STACKARR_LOG_DATABASE_URL', 'BOOKORBIT_DATABASE_URL', 'TRACEARR_DATABASE_URL'])
      result[key] = rewrite(env[key], 'database', target, key, ['postgres:', 'postgresql:']);
    if (env.ENABLE_TRACEARR === 'true') {
      if (!result.TRACEARR_DATABASE_URL) throw Error('Tracearr requires a PostgreSQL URL at the selected endpoint');
      const url = new URL(result.TRACEARR_DATABASE_URL);
      if (url.hostname !== target.host || url.port !== target.port)
        throw Error('Tracearr URL must target the external PostgreSQL endpoint');
    }
  }
  if (mode(env, 'redis') === 'external') {
    // The bundled Redis is unauthenticated; not all consumers expose auth settings.
    if (env.REDIS_USERNAME || env.REDIS_PASSWORD) throw Error('Authenticated external Redis is not supported');
    if (env.TRACEARR_REDIS_URL) {
      const url = new URL(env.TRACEARR_REDIS_URL);
      if (url.username || url.password) throw Error('Authenticated external Redis is not supported');
    }
    const target = endpoint(env, 'REDIS');
    for (const prefix of ['ROMM', 'IMMICH']) {
      result[`${prefix}_REDIS_HOST`] = target.host;
      result[`${prefix}_REDIS_PORT`] = target.port;
    }
    result.TRACEARR_REDIS_URL = rewrite(env.TRACEARR_REDIS_URL || 'redis://redis:6379', 'redis', target, 'TRACEARR_REDIS_URL', ['redis:']);
  }
  if (mode(env, 'mariadb') === 'external') {
    const target = endpoint(env, 'YOUTARR_DB');
    result.YOUTARR_DB_HOST = target.host;
    result.YOUTARR_DB_PORT = target.port;
  }
  return result;
}
function override(model, env) {
  project(env);
  const removed = Object.fromEntries(Object.entries(engines).filter(([engine]) => mode(env, engine) === 'external').map(([engine, [, name]]) => [name, engine]));
  if (!Object.keys(removed).length) return '{}\n';
  const services = {};
  for (const [name, engine] of Object.entries(removed)) {
    if (!model.services?.[name]) throw Error(`Missing managed ${engine} service`);
    services[name] = { profiles: [`stackarr-retained-${engine}`] };
  }
  for (const [name, service] of Object.entries(model.services || {})) {
    if (removed[name]) continue;
    const dependencies = service.depends_on || {};
    if (Object.keys(dependencies).some(key => removed[key]))
      services[name] = { ...services[name], depends_on: Object.fromEntries(Object.entries(dependencies).filter(([key]) => !removed[key])) };
    if (Object.values(service.environment || {}).some(value => typeof value === 'string' && value.includes('host.docker.internal')))
      services[name] = { ...services[name], extra_hosts: [
        ...(Array.isArray(service.extra_hosts) ? service.extra_hosts : Object.entries(service.extra_hosts || {}).map(([host, address]) => `${host}=${address}`))
          .filter(value => !String(value).startsWith('host.docker.internal=')),
        'host.docker.internal=host-gateway'
      ] };
  }
  const lines = ['services:'];
  for (const [name, entry] of Object.entries(services)) {
    if (!/^[a-z0-9_-]+$/.test(name)) throw Error('Invalid Compose service name');
    lines.push(`  ${name}:`);
    if (entry.profiles) lines.push(`    profiles: !override ${JSON.stringify(entry.profiles)}`);
    if (entry.depends_on) lines.push(`    depends_on: !override ${JSON.stringify(entry.depends_on)}`);
    if (entry.extra_hosts) lines.push(`    extra_hosts: !override ${JSON.stringify(entry.extra_hosts)}`);
  }
  return lines.join('\n') + '\n';
}
module.exports = { mode, endpoint, project, override, rewrite };
if (require.main === module) {
  try {
    const action = process.argv[2];
    if (action === 'env') {
      const projected = project(process.env);
      for (const [key, value] of Object.entries(projected)) if (value !== process.env[key])
        console.log(`export ${key}='${String(value).replaceAll("'", "'\\''")}'`);
    } else if (action === 'override') {
      const model = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      process.stdout.write(override(model, process.env));
    } else throw Error('Invalid action');
  } catch (error) {
    console.error(`Database endpoint configuration rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
