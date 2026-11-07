import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DockerContainerOverview } from '../../core/src/actions/containers';
import { containerHealthFindings } from '../../core/src/actions/health';
import { projectDatabaseEndpoints } from '../../core/src/databaseEndpoints';
import { managedEnvDefaults, mergeEditableEnv, redactEnv } from '../../core/src/env';
import type { ServiceSummary } from '../../core/src/services';

test('managed unified Timescale defaults do not rewrite client endpoints', () => {
  const env = { ...managedEnvDefaults, TRACEARR_DATABASE_URL: 'postgres://tracearr:p%40ss@database:5432/tracearr' };
  assert.equal(managedEnvDefaults['DATABASE_IMAGE'], 'timescale/timescaledb-ha:pg18.1-ts2.25.0');
  assert.deepEqual(projectDatabaseEndpoints(env), env);
  const legacy = projectDatabaseEndpoints({
    ...env,
    POSTGRES_DEPLOYMENT_MODE: 'independent',
    POSTGRES_HOST: 'db.example.invalid',
    POSTGRES_PORT: '5439'
  });
  assert.equal(new URL(legacy.TRACEARR_DATABASE_URL).hostname, 'db.example.invalid');
});

test('external PostgreSQL routes clients and preserves encoded credentials and URL parameters', () => {
  const env = projectDatabaseEndpoints({
    ...managedEnvDefaults,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example.invalid',
    POSTGRES_PORT: '5439',
    ENABLE_TRACEARR: 'true',
    TRACEARR_DATABASE_URL: 'postgres://tr%40ce:p%3A%2F%23%3F%26%25@database:5432/tracearr?sslmode=require',
    BOOKORBIT_DATABASE_URL: 'postgres://book:pa%25ss@database:5432/books',
    STACKARR_DATABASE_URL: 'postgres://stack:p%40ss@database:5432/main'
  });
  const trace = new URL(env.TRACEARR_DATABASE_URL);
  assert.equal(trace.hostname, 'db.example.invalid');
  assert.equal(trace.port, '5439');
  assert.equal(trace.username, 'tr%40ce');
  assert.equal(trace.password, 'p%3A%2F%23%3F%26%25');
  assert.equal(trace.search, '?sslmode=require');
  assert.equal(env.BOOKORBIT_DATABASE_URL, 'postgres://book:pa%25ss@db.example.invalid:5439/books');
  assert.equal(env.STACKARR_DATABASE_URL, 'postgres://stack:p%40ss@db.example.invalid:5439/main');
  assert.equal(env.RADARR_POSTGRES_HOST, 'db.example.invalid');
  assert.equal(env.CLEANUPARR_POSTGRES_PORT, '5439');
  assert.deepEqual(projectDatabaseEndpoints(env), env);
});

test('external endpoints reject absent, loopback, managed aliases, invalid ports and Redis auth', () => {
  for (const [host, port] of [
    ['', '5432'],
    ['localhost', '5432'],
    ['database', '5432'],
    ['db.example', '0'],
    ['db.example', '65536']
  ])
    assert.throws(() =>
      projectDatabaseEndpoints({
        ...managedEnvDefaults,
        POSTGRES_DEPLOYMENT_MODE: 'external',
        POSTGRES_HOST: host,
        POSTGRES_PORT: port
      })
    );
  assert.throws(() =>
    projectDatabaseEndpoints({
      ...managedEnvDefaults,
      REDIS_DEPLOYMENT_MODE: 'external',
      REDIS_HOST: 'cache.example',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'secret'
    })
  );
  assert.throws(
    () =>
      projectDatabaseEndpoints({
        ...managedEnvDefaults,
        REDIS_DEPLOYMENT_MODE: 'external',
        REDIS_HOST: 'cache.example',
        REDIS_PORT: '6379',
        TRACEARR_REDIS_URL: 'rediss://redis:6379'
      }),
    /TRACEARR_REDIS_URL/
  );
  assert.throws(() => projectDatabaseEndpoints({ ...managedEnvDefaults, POSTGRES_DEPLOYMENT_MODE: 'unexpected' }));
});

test('redacted config save roundtrip retains external Tracearr URL', () => {
  const current = projectDatabaseEndpoints({
    ...managedEnvDefaults,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example.invalid',
    POSTGRES_PORT: '5439',
    ENABLE_TRACEARR: 'true',
    TRACEARR_DATABASE_URL: 'postgres://tracearr:p%40ss@db.example.invalid:5439/tracearr'
  });
  const saved = projectDatabaseEndpoints(mergeEditableEnv(current, redactEnv(current)));
  assert.equal(saved.TRACEARR_DATABASE_URL, current.TRACEARR_DATABASE_URL);
});

test('health keeps restart=no warning without proof of an active matching monitor', () => {
  const service = (name: string, mode: 'native' | 'docker') =>
    ({ name, mode, dockerService: mode === 'docker' ? name : undefined }) as ServiceSummary;
  const overview = {
    dockerAvailable: true,
    containers: [
      { composeProject: 'stackarr', composeService: 'app', running: true, status: 'Up', restartPolicy: 'no' }
    ]
  } as DockerContainerOverview;
  assert.deepEqual(containerHealthFindings([service('database', 'native')], overview), []);
  assert.ok(containerHealthFindings([service('app', 'docker')], overview).some((f) => f.message.includes('restart')));
  assert.ok(
    containerHealthFindings([service('app', 'docker')], overview, 'other').some((f) => f.message.includes('absent'))
  );
});

test('endpoint transitions fail closed until every URL is explicitly reconciled; no data is moved', () => {
  const base = {
    ...managedEnvDefaults,
    ENABLE_TRACEARR: 'true',
    TRACEARR_DATABASE_URL: 'postgres://tracearr:password@database:5432/tracearr',
    BOOKORBIT_DATABASE_URL: 'postgres://book:password@database:5432/books',
    STACKARR_DATABASE_URL: 'postgres://stack:password@database:5432/main'
  };
  const external = projectDatabaseEndpoints({
    ...base,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db-a.example',
    POSTGRES_PORT: '5439'
  });
  assert.throws(
    () => projectDatabaseEndpoints({ ...external, POSTGRES_HOST: 'db-b.example' }),
    /TRACEARR_DATABASE_URL|BOOKORBIT_DATABASE_URL|STACKARR_DATABASE_URL/
  );
  assert.throws(() => projectDatabaseEndpoints({ ...external, POSTGRES_DEPLOYMENT_MODE: 'managed' }), /POSTGRES_HOST/);
  assert.throws(
    () => projectDatabaseEndpoints({ ...external, POSTGRES_DEPLOYMENT_MODE: 'managed', POSTGRES_HOST: '' }),
    /must target database/
  );
  assert.throws(
    () =>
      projectDatabaseEndpoints({
        ...base,
        POSTGRES_DEPLOYMENT_MODE: 'external',
        POSTGRES_HOST: 'db-a.example',
        POSTGRES_PORT: '5439',
        TRACEARR_DATABASE_URL: 'redis://redis:6379'
      }),
    /TRACEARR_DATABASE_URL/
  );
  const reconciled = projectDatabaseEndpoints({
    ...external,
    POSTGRES_HOST: 'db-b.example',
    TRACEARR_DATABASE_URL: external.TRACEARR_DATABASE_URL.replace('db-a.example', 'db-b.example'),
    BOOKORBIT_DATABASE_URL: external.BOOKORBIT_DATABASE_URL.replace('db-a.example', 'db-b.example'),
    STACKARR_DATABASE_URL: external.STACKARR_DATABASE_URL.replace('db-a.example', 'db-b.example')
  });
  assert.equal(new URL(reconciled.TRACEARR_DATABASE_URL).hostname, 'db-b.example');
});

test('Pulsarr advanced role credentials reach Compose consumer and MariaDB selector is separate', () => {
  const external = projectDatabaseEndpoints({
    ...managedEnvDefaults,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example',
    POSTGRES_PORT: '5439',
    PULSARR_DB_TYPE: 'postgres',
    PULSARR_POSTGRES_USER: 'role',
    PULSARR_POSTGRES_DATABASE: 'catalog',
    PULSARR_POSTGRES_PASSWORD: 'secret',
    PULSARR_DB_USER: 'stale',
    PULSARR_DB_PASSWORD: 'stale',
    PULSARR_DB_NAME: 'stale'
  });
  assert.equal(external.PULSARR_DB_USER, 'role');
  assert.equal(external.PULSARR_DB_NAME, 'catalog');
  assert.equal(external.PULSARR_DB_PASSWORD, 'secret');
  const managed = projectDatabaseEndpoints({
    ...managedEnvDefaults,
    PULSARR_DB_TYPE: 'postgres',
    PULSARR_DB_HOST: 'database',
    PULSARR_POSTGRES_USER: 'managed-role',
    PULSARR_POSTGRES_PASSWORD: 'managed-secret'
  });
  assert.equal(managed.PULSARR_DB_USER, 'managed-role');
  assert.equal(managed.PULSARR_DB_PASSWORD, 'managed-secret');
  assert.throws(
    () =>
      projectDatabaseEndpoints({
        ...managedEnvDefaults,
        YOUTARR_DATABASE_DEPLOYMENT_MODE: 'external',
        YOUTARR_DB_HOST: '',
        YOUTARR_DB_PORT: ''
      }),
    /YOUTARR_DB/
  );
  const maria = projectDatabaseEndpoints({
    ...managedEnvDefaults,
    YOUTARR_DATABASE_DEPLOYMENT_MODE: 'external',
    YOUTARR_DB_HOST: 'maria.example',
    YOUTARR_DB_PORT: '3307'
  });
  assert.equal(maria.YOUTARR_DB_HOST, 'maria.example');
  assert.equal(maria.YOUTARR_DB_PORT, '3307');
  assert.throws(
    () => projectDatabaseEndpoints({ ...maria, YOUTARR_DATABASE_DEPLOYMENT_MODE: 'managed' }),
    /YOUTARR_DB_HOST/
  );
});
