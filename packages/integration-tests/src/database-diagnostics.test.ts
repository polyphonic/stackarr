import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getDatabaseDiagnostics, psqlDiagnosticsQuery } from '../../core/src/databaseDiagnostics';
import { managedEnvDefaults } from '../../core/src/env';

const engine = JSON.stringify({ engine: 'PostgreSQL', version: '18.1' });
const extensions = JSON.stringify([
  { name: 'cube', installedVersion: '1.5', availableVersion: '1.5' },
  { name: 'vector', installedVersion: null, availableVersion: '0.8.1' },
  { name: 'timescaledb', installedVersion: '2.25', availableVersion: '2.25' }
]);
const settings = JSON.stringify([{ name: 'shared_preload_libraries', value: 'timescaledb', pendingRestart: true }]);
const fixture = {
  ...managedEnvDefaults,
  STACKARR_DATABASE_MODE: 'app-default',
  ENABLE_IMMICH: 'true',
  IMMICH_DB_DATABASE_NAME: 'photos',
  IMMICH_DB_USERNAME: 'photos_role',
  IMMICH_DB_PASSWORD: 'dont-output-this',
  ENABLE_TRACEARR: 'true',
  TRACEARR_POSTGRES_DATABASE: 'metrics',
  TRACEARR_POSTGRES_USER: 'metrics_role',
  TRACEARR_POSTGRES_PASSWORD: 'dont-output-this-either',
  TRACEARR_DATABASE_URL: ''
};

test('per-database inventories and required labels follow actual provisioning contracts', async () => {
  const calls: Array<{ database: string; sql: string }> = [];
  const result = await getDatabaseDiagnostics(fixture, async (credential, sql) => {
    calls.push({ database: credential.database, sql });
    if (sql.includes('server_version')) return engine;
    if (sql.includes('pg_available_extensions'))
      return credential.database === 'photos'
        ? extensions
        : JSON.stringify([{ name: 'timescaledb', installedVersion: '2.25', availableVersion: '2.25' }]);
    return settings;
  });
  assert.equal(result.mode, 'managed');
  assert.equal(result.version, '18.1');
  assert.equal(result.settings[0]?.pendingRestart, true);
  assert.equal(result.settingsState, 'insufficient_permission');
  assert.ok(result.restrictedSettings.includes('max_connections'));
  assert.deepEqual(
    result.databases.map((d) => d.database),
    ['photos', 'metrics']
  );
  assert.equal(result.databases[0]?.extensions.find((e) => e.name === 'vector')?.required, true);
  assert.equal(result.databases[0]?.extensions.find((e) => e.name === 'vector')?.installedVersion, null);
  assert.equal(result.databases[1]?.extensions.find((e) => e.name === 'timescaledb')?.required, true);
  assert.equal(
    result.databases[1]?.extensions.find((e) => e.name === 'vector'),
    undefined
  );
  assert.ok(calls.every((c) => !/dont-output|CREATE|ALTER|DROP/i.test(c.sql)));
  assert.ok(!JSON.stringify(result).includes('dont-output'));
});

test('incomplete enabled database targets stay visible without querying or leaking malformed URLs', async () => {
  let calls = 0;
  const result = await getDatabaseDiagnostics(
    { ...fixture, IMMICH_DB_PASSWORD: '', TRACEARR_DATABASE_URL: 'invalid:secret-credential' },
    async () => {
      calls++;
      return engine;
    }
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    result.databases.map((item) => [item.app, item.state]),
    [
      ['IMMICH', 'not_configured'],
      ['TRACEARR', 'not_configured']
    ]
  );
  assert.equal(result.state, 'not_configured');
  assert.doesNotMatch(JSON.stringify(result), /secret-credential|dont-output/);
});

test('explicit permission and unreachable states do not leak errors or credentials', async () => {
  const result = await getDatabaseDiagnostics(fixture, async (credential, sql) => {
    if (credential.database === 'photos') throw new Error('permission denied for secret dont-output-this');
    if (sql.includes('server_version'))
      throw new Error('connection refused at private.internal:5432 password=dont-output-this-either');
    return extensions;
  });
  assert.deepEqual(
    result.databases.map((d) => d.state),
    ['insufficient_permission', 'unreachable']
  );
  assert.ok(!JSON.stringify(result).includes('dont-output'));
  assert.ok(!JSON.stringify(result).includes('private.internal'));
});

test('settings permission denial preserves per-database inventory', async () => {
  const result = await getDatabaseDiagnostics(fixture, async (_credential, sql) => {
    if (sql.includes('server_version')) return engine;
    if (sql.includes('pg_available_extensions')) return extensions;
    throw new Error('permission denied for pg_settings');
  });
  assert.equal(result.settingsState, 'insufficient_permission');
  assert.equal(result.databases[0]?.state, 'ok');
  assert.equal(result.databases[0]?.extensions.find((e) => e.name === 'vector')?.availableVersion, '0.8.1');
  assert.equal(result.databases[0]?.extensions.find((e) => e.name === 'earthdistance')?.availableVersion, null);
});

test('external mode does not write, honors endpoint and bounds extension inventory', async () => {
  const env = {
    ...fixture,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example.invalid',
    POSTGRES_PORT: '5439'
  };
  let count = 0;
  const result = await getDatabaseDiagnostics(env, async (credential, sql) => {
    count++;
    assert.equal(credential.host, 'db.example.invalid');
    assert.equal(credential.port, '5439');
    assert.match(sql, /^SELECT /);
    assert.match(sql, /LIMIT (129|5)|server_version/);
    if (sql.includes('server_version')) return engine;
    if (sql.includes('pg_available_extensions'))
      return JSON.stringify(
        Array.from({ length: 129 }, (_, i) => ({ name: `ext_${i}`, installedVersion: null, availableVersion: '1.0' }))
      );
    return settings;
  });
  assert.equal(result.mode, 'external');
  assert.equal(result.databases[0]?.truncated, true);
  assert.ok(result.databases[0]!.extensions.length <= 132); // 128 catalog rows plus conditional contract labels.
  assert.ok(count <= 7);
});

test('same database name across app endpoints retains both associations and URL TLS policy', async () => {
  const env = {
    ...fixture,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example.invalid',
    POSTGRES_PORT: '5439',
    IMMICH_DB_HOSTNAME: 'photos.example.invalid',
    IMMICH_DB_PORT: '5438',
    TRACEARR_POSTGRES_DATABASE: 'photos',
    TRACEARR_DATABASE_URL: 'postgres://role:pass@other.example.invalid:5440/photos?sslmode=verify-full'
  };
  const seen: Array<{ host: string; sslmode?: string }> = [];
  const result = await getDatabaseDiagnostics(env, async (credential, sql) => {
    if (sql.includes('server_version')) seen.push({ host: credential.host, sslmode: credential.sslmode });
    return sql.includes('server_version') ? engine : sql.includes('pg_available_extensions') ? extensions : settings;
  });
  assert.deepEqual(
    result.databases.map((d) => d.app),
    ['IMMICH', 'TRACEARR']
  );
  assert.deepEqual(
    result.databases.map((d) => d.endpoint),
    ['photos.example.invalid:5438', 'other.example.invalid:5440']
  );
  assert.deepEqual(
    result.databases.map((d) => d.role),
    ['photos_role', 'role']
  );
  assert.deepEqual(
    seen.sort((a, b) => a.host.localeCompare(b.host)),
    [
      { host: 'other.example.invalid', sslmode: 'verify-full' },
      { host: 'photos.example.invalid', sslmode: 'disable' }
    ]
  );
});

test('URL without sslmode uses the application default, including encoded conninfo-like database names', async () => {
  const env = {
    ...fixture,
    ENABLE_IMMICH: 'false',
    TRACEARR_DATABASE_URL: 'postgres://role:secret@db.example.invalid:5432/host%3Devil%20dbname%3Dother'
  };
  let seen: { database: string; sslmode?: string } | undefined;
  await getDatabaseDiagnostics(env, async (credential, sql) => {
    if (sql.includes('server_version')) seen = { database: credential.database, sslmode: credential.sslmode };
    return sql.includes('server_version') ? engine : sql.includes('pg_available_extensions') ? extensions : settings;
  });
  assert.deepEqual(seen, { database: 'host=evil dbname=other', sslmode: 'disable' });
});

test('query includes installed extensions absent from the available catalog and marks restricted settings', async () => {
  let extensionSql = '';
  const result = await getDatabaseDiagnostics(fixture, async (_credential, sql) => {
    if (sql.includes('server_version')) return engine;
    if (sql.includes('pg_available_extensions')) {
      extensionSql = sql;
      return JSON.stringify([{ name: 'orphan', installedVersion: '1.0', availableVersion: null }]);
    }
    return JSON.stringify([{ name: 'max_connections', value: null, pendingRestart: false }]);
  });
  assert.match(extensionSql, /FULL JOIN pg_extension/);
  assert.match(extensionSql, /coalesce\(a.name, x.extname\)/);
  assert.match(extensionSql, /ORDER BY \(x.extname IS NULL\), name/);
  assert.equal(result.databases[0]?.extensions.find((e) => e.name === 'orphan')?.installedVersion, '1.0');
  assert.equal(result.settingsState, 'insufficient_permission');
  assert.deepEqual(result.settings, []);
});

test('inspection has a global deadline and at most four concurrent queries', async () => {
  const env = {
    ...fixture,
    STACKARR_DATABASE_MODE: 'postgres',
    STACKARR_POSTGRES_USER: 'role',
    STACKARR_POSTGRES_PASSWORD: 'password',
    STACKARR_POSTGRES_MAIN_DATABASE: 'main',
    STACKARR_POSTGRES_LOG_DATABASE: 'log',
    PROWLARR_POSTGRES_USER: 'role',
    PROWLARR_POSTGRES_PASSWORD: 'password',
    PROWLARR_POSTGRES_MAIN_DATABASE: 'prowlarr',
    PROWLARR_POSTGRES_LOG_DATABASE: 'prowlarr-log',
    RADARR_POSTGRES_USER: 'role',
    RADARR_POSTGRES_PASSWORD: 'password',
    RADARR_POSTGRES_MAIN_DATABASE: 'radarr',
    RADARR_POSTGRES_LOG_DATABASE: 'radarr-log'
  };
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const started = Date.now();
  const result = await getDatabaseDiagnostics(env, async (_credential, _sql, signal) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    return new Promise<string>((_resolve, reject) =>
      signal?.addEventListener(
        'abort',
        () => {
          active--;
          reject(new Error('connection timeout'));
        },
        { once: true }
      )
    );
  });
  assert.ok(Date.now() - started < 10000);
  assert.ok(maximum <= 4);
  assert.ok(calls <= 4);
  assert.ok(result.databases.length >= 6);
  for (const app of [
    'Stackarr',
    'Stackarr log',
    'PROWLARR',
    'PROWLARR log',
    'RADARR',
    'RADARR log',
    'IMMICH',
    'TRACEARR'
  ]) {
    assert.equal(result.databases.find((item) => item.app === app)?.state, 'unreachable', app);
  }
  assert.ok(result.databases.every((item) => item.state === (item.endpoint ? 'unreachable' : 'not_configured')));
});

test('psql command treats dbname as a literal, isolates PG environment, and bounds output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stackarr-diagnostics-'));
  const previousPath = process.env.PATH;
  const previousService = process.env.PGSERVICE;
  const previousPassfile = process.env.PGPASSFILE;
  const previousServicefile = process.env.PGSERVICEFILE;
  try {
    const file = join(dir, 'psql');
    writeFileSync(
      file,
      `#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({args:process.argv.slice(2),env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('PG')))}));});\n`
    );
    chmodSync(file, 0o755);
    process.env.PATH = `${dir}:${previousPath}`;
    process.env.PGSERVICE = 'untrusted';
    process.env.PGSERVICEFILE = '/untrusted';
    process.env.PGPASSFILE = '/untrusted';
    const credential = {
      host: 'db.example.invalid',
      port: '5432',
      user: 'role',
      password: 'secret',
      database: "host=evil dbname='override'\\x",
      sslmode: 'verify-full'
    };
    const output = JSON.parse(await psqlDiagnosticsQuery(credential, 'SELECT 1'));
    assert.equal(output.args[output.args.indexOf('-d') + 1], "dbname='host=evil dbname=\\'override\\'\\\\x'");
    assert.ok(output.args.includes('-w'));
    assert.ok(!JSON.stringify(output.args).includes('secret'));
    assert.equal(output.env.PGSSLMODE, 'verify-full');
    assert.equal(
      JSON.parse(await psqlDiagnosticsQuery({ ...credential, sslmode: undefined }, 'SELECT 1')).env.PGSSLMODE,
      'disable'
    );
    assert.equal(output.env.PGSERVICE, undefined);
    assert.equal(output.env.PGSERVICEFILE, undefined);
    assert.equal(output.env.PGPASSFILE, undefined);
    assert.match(output.env.PGOPTIONS, /default_transaction_read_only=on/);
    writeFileSync(file, `#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(200000));\n`);
    await assert.rejects(psqlDiagnosticsQuery(credential, 'SELECT 1'), /query failed|connection timeout/);
    writeFileSync(file, `#!/usr/bin/env node\nprocess.stderr.write('secret'.repeat(2000));process.exitCode=1;\n`);
    await assert.rejects(psqlDiagnosticsQuery(credential, 'SELECT 1'), /query failed|connection timeout/);
    writeFileSync(file, `#!/usr/bin/env node\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`);
    const signal = AbortSignal.timeout(50);
    await assert.rejects(psqlDiagnosticsQuery(credential, 'SELECT 1', signal), /connection timeout/);
  } finally {
    process.env.PATH = previousPath;
    if (previousService === undefined) delete process.env.PGSERVICE;
    else process.env.PGSERVICE = previousService;
    if (previousPassfile === undefined) delete process.env.PGPASSFILE;
    else process.env.PGPASSFILE = previousPassfile;
    if (previousServicefile === undefined) delete process.env.PGSERVICEFILE;
    else process.env.PGSERVICEFILE = previousServicefile;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API route authenticates before invoking diagnostics and never accepts SQL/write requests', () => {
  const route = readFileSync(
    new URL('../../../apps/frontend/src/app/api/v1/database/diagnostics/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(
    route,
    /const auth = requireApiKey\(request\);\s*if \(auth\) return auth;\s*try \{\s*return json\(await getDatabaseDiagnostics\(readEnv\(\)\)/
  );
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
});
