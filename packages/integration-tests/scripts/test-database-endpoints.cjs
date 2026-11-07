const assert = require('node:assert/strict');
const { test } = require('node:test');
const { project, override } = require('../../../stackarr/scripts/database-endpoints.cjs');

test('managed projection leaves defaults unchanged and has no topology override', () => {
  const env = { TRACEARR_DATABASE_URL: 'postgres://tracearr:p%40ss@database:5432/tracearr' };
  assert.deepEqual(project(env), env);
  assert.equal(override({}, env), '{}\n');
});

test('external projection retains encoded URL credentials and removes retired dependencies', () => {
  const env = {
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'host.docker.internal',
    POSTGRES_PORT: '5439',
    TRACEARR_DATABASE_URL: 'postgres://tr%40ce:p%3A%2F%23%3F%26%25@database:5432/tracearr?sslmode=require'
  };
  assert.equal(new URL(project(env).TRACEARR_DATABASE_URL).password, 'p%3A%2F%23%3F%26%25');
  const yaml = override(
    {
      services: {
        database: {},
        redis: {},
        tracearr: {
          depends_on: {
            database: { condition: 'service_healthy' },
            redis: { condition: 'service_healthy' }
          },
          environment: { DATABASE_URL: project(env).TRACEARR_DATABASE_URL },
          extra_hosts: ['existing.internal=192.0.2.1']
        }
      }
    },
    env
  );
  assert.match(yaml, /database:\n    profiles: !override \["stackarr-retained-postgres"\]/);
  assert.match(yaml, /tracearr:\n    depends_on: !override \{"redis":/);
  assert.match(yaml, /extra_hosts: !override .*host-gateway/);
  assert.match(yaml, /existing.internal=192.0.2.1/);
});

test('invalid external endpoints fail closed', () => {
  for (const host of ['', '127.0.0.1', 'database', 'bad host'])
    assert.throws(() => project({ POSTGRES_DEPLOYMENT_MODE: 'external', POSTGRES_HOST: host, POSTGRES_PORT: '5432' }));
  assert.throws(() =>
    project({
      REDIS_DEPLOYMENT_MODE: 'external',
      REDIS_HOST: 'cache.example',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'secret'
    })
  );
  assert.throws(
    () =>
      project({
        REDIS_DEPLOYMENT_MODE: 'external',
        REDIS_HOST: 'cache.example',
        REDIS_PORT: '6379',
        TRACEARR_REDIS_URL: 'rediss://redis:6379'
      }),
    /TRACEARR_REDIS_URL/
  );
});

test('host projection rejects stale external URLs, managed leftovers and invalid Tracearr targets', () => {
  const base = {
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db-a.example',
    POSTGRES_PORT: '5439',
    ENABLE_TRACEARR: 'true',
    TRACEARR_DATABASE_URL: 'postgres://tracearr:pass@database:5432/tracearr',
    BOOKORBIT_DATABASE_URL: 'postgres://book:pass@database:5432/books',
    STACKARR_DATABASE_URL: 'postgres://stack:pass@database:5432/main'
  };
  const current = project(base);
  assert.throws(() => project({ ...current, POSTGRES_HOST: 'db-b.example' }), /different endpoint/);
  assert.throws(() => project({ ...current, POSTGRES_DEPLOYMENT_MODE: 'managed' }), /Clear POSTGRES_HOST/);
  assert.throws(
    () => project({ ...current, POSTGRES_DEPLOYMENT_MODE: 'managed', POSTGRES_HOST: '' }),
    /must target database/
  );
  assert.throws(() => project({ ...base, TRACEARR_DATABASE_URL: 'redis://redis:6379' }), /TRACEARR_DATABASE_URL/);
  assert.throws(() => project({ ...base, TRACEARR_DATABASE_URL: '' }), /Tracearr requires/);
  const reconciled = project({
    ...current,
    POSTGRES_HOST: 'db-b.example',
    TRACEARR_DATABASE_URL: current.TRACEARR_DATABASE_URL.replace('db-a.example', 'db-b.example'),
    BOOKORBIT_DATABASE_URL: current.BOOKORBIT_DATABASE_URL.replace('db-a.example', 'db-b.example'),
    STACKARR_DATABASE_URL: current.STACKARR_DATABASE_URL.replace('db-a.example', 'db-b.example')
  });
  assert.equal(new URL(reconciled.TRACEARR_DATABASE_URL).hostname, 'db-b.example');
});

test('advanced Pulsarr role and independent MariaDB selector reach consumers', () => {
  const env = project({
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example',
    POSTGRES_PORT: '5439',
    PULSARR_DB_TYPE: 'postgres',
    PULSARR_POSTGRES_USER: 'role',
    PULSARR_POSTGRES_PASSWORD: 'secret',
    PULSARR_POSTGRES_DATABASE: 'catalog',
    PULSARR_DB_USER: 'stale',
    PULSARR_DB_PASSWORD: 'stale'
  });
  assert.equal(env.PULSARR_DB_USER, 'role');
  assert.equal(env.PULSARR_DB_PASSWORD, 'secret');
  assert.equal(env.PULSARR_DB_NAME, 'catalog');
  const managed = project({
    PULSARR_DB_TYPE: 'postgres',
    PULSARR_DB_HOST: 'database',
    PULSARR_POSTGRES_USER: 'managed-role',
    PULSARR_POSTGRES_PASSWORD: 'managed-secret'
  });
  assert.equal(managed.PULSARR_DB_USER, 'managed-role');
  assert.equal(managed.PULSARR_DB_PASSWORD, 'managed-secret');
  assert.throws(
    () => project({ YOUTARR_DATABASE_DEPLOYMENT_MODE: 'external', YOUTARR_DB_HOST: '', YOUTARR_DB_PORT: '' }),
    /YOUTARR_DB/
  );
  const maria = project({
    YOUTARR_DATABASE_DEPLOYMENT_MODE: 'external',
    YOUTARR_DB_HOST: 'maria.example',
    YOUTARR_DB_PORT: '3307'
  });
  assert.equal(maria.YOUTARR_DB_HOST, 'maria.example');
  assert.equal(maria.YOUTARR_DB_PORT, '3307');
  assert.throws(() => project({ ...maria, YOUTARR_DATABASE_DEPLOYMENT_MODE: 'managed' }), /YOUTARR_DB_HOST/);
});
