import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createReadEngine, requiredEnginesForService } = require('../../../stackarr/scripts/image-dependency-probe.cjs');
const env = {
  COMPOSE_PROJECT_NAME: 'stackarr',
  POSTGRES_DEPLOYMENT_MODE: 'external',
  POSTGRES_HOST: 'pg.example',
  POSTGRES_PORT: '5432',
  REDIS_DEPLOYMENT_MODE: 'independent',
  REDIS_HOST: 'cache.example',
  REDIS_PORT: '6379',
  YOUTARR_DATABASE_DEPLOYMENT_MODE: 'external',
  YOUTARR_DB_HOST: 'sql.example',
  YOUTARR_DB_PORT: '3306'
};
const services = {
  tracearr: {
    environment: {
      DATABASE_URL: 'postgres://app:private@pg.example:5432/appdb',
      REDIS_URL: 'redis://cache.example:6379'
    }
  },
  youtarr: {
    environment: { DB_HOST: 'sql.example', DB_PORT: '3306', DB_NAME: 'videos', DB_USER: 'app', DB_PASSWORD: 'private' }
  },
  romm: {
    environment: {
      ROMM_DB_DRIVER: 'postgresql',
      DB_HOST: 'pg.example',
      DB_PORT: '5432',
      DB_NAME: 'games',
      DB_USER: 'app',
      DB_PASSWD: 'private',
      REDIS_HOST: 'cache.example',
      REDIS_PORT: '6379'
    }
  },
  app: { environment: { STACKARR_DATABASE_MODE: 'app-default' } }
};
const compose = { name: 'stackarr', services };
const context = (service: string) => ({ service, project: 'stackarr', daemonId: 'daemon-one' });
const pgOutput = JSON.stringify({
  version: '180001',
  extensions: [
    { name: 'vector', version: '0.8.1' },
    { name: 'timescaledb', version: '2.25.0' }
  ]
});
const output = ({ command }: any) =>
  command === 'psql' ? pgOutput : command === 'redis-cli' ? '# Server\r\nredis_version:8.8.0\r\n' : '10.11.9-MariaDB\n';

test('discovers only known configured dependencies, including Redis alongside PG', () => {
  assert.deepEqual(requiredEnginesForService({ compose, env, service: 'tracearr', project: 'stackarr' }), [
    'postgresql',
    'redis'
  ]);
  assert.deepEqual(requiredEnginesForService({ compose, env, service: 'romm', project: 'stackarr' }), [
    'postgresql',
    'redis'
  ]);
  assert.deepEqual(requiredEnginesForService({ compose, env, service: 'youtarr', project: 'stackarr' }), ['mariadb']);
  assert.deepEqual(requiredEnginesForService({ compose, env, service: 'app', project: 'stackarr' }), []);
  assert.equal(requiredEnginesForService({ compose, env, service: 'unknown', project: 'stackarr' }), null);
  assert.equal(requiredEnginesForService({ compose, env, service: 'tracearr', project: 'wrong' }), null);
});
test('fresh fixed client queries return server versions and per-database extension inventory', async () => {
  const calls: any[] = [];
  const read = createReadEngine({
    compose,
    env,
    run: async (request: any) => {
      calls.push(request);
      return output(request);
    }
  });
  assert.deepEqual(await read('postgresql', context('tracearr')), {
    engine: 'postgresql',
    version: '18.1',
    extensions: [
      { name: 'vector', version: '0.8.1' },
      { name: 'timescaledb', version: '2.25.0' }
    ],
    attested: true
  });
  assert.deepEqual(await read('redis', context('tracearr')), {
    engine: 'redis',
    version: '8.8.0',
    extensions: [],
    attested: true
  });
  assert.deepEqual(await read('mariadb', context('youtarr')), {
    engine: 'mariadb',
    version: '10.11.9',
    extensions: [],
    attested: true
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].command, 'psql');
  assert.match(calls[0].input, /pg_extension/);
  assert.match(calls[0].input, /server_version_num/);
  assert.equal(calls[0].env.PGPASSWORD, 'private');
  assert.equal(calls[0].args.includes('private'), false);
  assert.equal(calls[1].command, 'redis-cli');
  assert.deepEqual(calls[1].args.slice(-2), ['INFO', 'server']);
  assert.equal(calls[2].command, 'mariadb');
  assert.equal(calls[2].input, 'SELECT VERSION();');
  assert.equal(calls[2].env.MYSQL_PWD, 'private');
  await read('postgresql', context('tracearr'));
  assert.equal(calls.length, 4, 'no cached attestation');
});
test('wrong endpoint, mode, identity, missing client and redacted errors all HOLD', async () => {
  const wrong = {
    ...compose,
    services: {
      ...services,
      tracearr: {
        environment: { ...services.tracearr.environment, DATABASE_URL: 'postgres://app:private@database:5432/appdb' }
      }
    }
  };
  let called = 0;
  const run = async (r: any) => {
    called++;
    return output(r);
  };
  assert.equal(requiredEnginesForService({ compose: wrong, env, service: 'tracearr', project: 'stackarr' }), null);
  assert.equal(await createReadEngine({ compose: wrong, env, run })('postgresql', context('tracearr')), null);
  assert.equal(called, 0);
  assert.equal(
    await createReadEngine({ compose, env, run })('postgresql', { ...context('tracearr'), daemonId: '' }),
    null
  );
  assert.equal(
    await createReadEngine({ compose, env: { ...env, POSTGRES_DEPLOYMENT_MODE: 'other' }, run })(
      'postgresql',
      context('tracearr')
    ),
    null
  );
  assert.equal(
    await createReadEngine({
      compose,
      env,
      run: async () => {
        throw Error('private pg.example');
      }
    })('postgresql', context('tracearr')),
    null
  );
});
test('per-database PG proof never substitutes available or missing extensions', async () => {
  const missing = createReadEngine({
    compose,
    env,
    run: async () => JSON.stringify({ version: '180001', extensions: [] })
  });
  assert.deepEqual(await missing('postgresql', context('tracearr')), {
    engine: 'postgresql',
    version: '18.1',
    extensions: [],
    attested: true
  });
  const overflow = createReadEngine({
    compose,
    env,
    run: async () =>
      JSON.stringify({
        version: '180001',
        extensions: Array.from({ length: 33 }, (_, i) => ({ name: `x${i}`, version: '1.0' }))
      })
  });
  assert.equal(await overflow('postgresql', context('tracearr')), null);
  assert.equal(
    await createReadEngine({ compose, env, run: async () => '18.1' })('postgresql', context('tracearr')),
    null,
    'binary version cannot prove a server'
  );
});
test('multi-database PG only attests extensions installed at every selected database', async () => {
  const local = {
    ...compose,
    services: {
      ...services,
      app: {
        environment: {
          STACKARR_DATABASE_MODE: 'postgres',
          STACKARR_DATABASE_URL: 'postgres://app:private@pg.example:5432/main',
          STACKARR_LOG_DATABASE_URL: 'postgres://app:private@pg.example:5432/log'
        }
      }
    }
  };
  const names: string[] = [];
  const read = createReadEngine({
    compose: local,
    env,
    run: async ({ args }: any) => {
      names.push(args[args.indexOf('-d') + 1]);
      return JSON.stringify({
        version: '90624',
        extensions: names.length === 1 ? [{ name: 'vector', version: '0.8' }] : []
      });
    }
  });
  assert.deepEqual(requiredEnginesForService({ compose: local, env, service: 'app', project: 'stackarr' }), [
    'postgresql'
  ]);
  assert.deepEqual(await read('postgresql', context('app')), {
    engine: 'postgresql',
    version: '9.6.24',
    extensions: [],
    attested: true
  });
  assert.deepEqual(names, ["dbname='main'", "dbname='log'"]);
});
test('unresponsive adapter cannot forge a completed attestation', async () => {
  const read = createReadEngine({ compose, env, run: async () => new Promise(() => {}) });
  assert.equal(await read('redis', context('tracearr')), null);
});

test('managed cannot silently use external or retired endpoint; client absence holds', async () => {
  const managed = {
    ...env,
    POSTGRES_DEPLOYMENT_MODE: 'managed',
    REDIS_DEPLOYMENT_MODE: 'managed',
    YOUTARR_DATABASE_DEPLOYMENT_MODE: 'managed'
  };
  const read = createReadEngine({
    compose,
    env: managed,
    run: async () => {
      throw Error('ENOENT');
    }
  });
  assert.equal(await read('postgresql', context('tracearr')), null);
  assert.equal(await read('redis', context('tracearr')), null);
  assert.equal(await read('mariadb', context('youtarr')), null);
  assert.equal(requiredEnginesForService({ compose, env: managed, service: 'tracearr', project: 'stackarr' }), null);
});
