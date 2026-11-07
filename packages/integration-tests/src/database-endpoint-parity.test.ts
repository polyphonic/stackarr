import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { projectDatabaseEndpoints } from '../../core/src/databaseEndpoints';
import { managedEnvDefaults } from '../../core/src/env';

const require = createRequire(import.meta.url);
const shell = require('../../../stackarr/scripts/database-endpoints.cjs') as {
  project: (env: Record<string, string>) => Record<string, string>;
};

test('TS and shell projections agree on selected external endpoints and retained credentials', () => {
  const env = {
    ...managedEnvDefaults,
    POSTGRES_DEPLOYMENT_MODE: 'external',
    POSTGRES_HOST: 'db.example.invalid',
    POSTGRES_PORT: '5439',
    REDIS_DEPLOYMENT_MODE: 'external',
    REDIS_HOST: 'cache.example.invalid',
    REDIS_PORT: '6380',
    YOUTARR_DATABASE_DEPLOYMENT_MODE: 'external',
    YOUTARR_DB_HOST: 'maria.example.invalid',
    YOUTARR_DB_PORT: '3307',
    PULSARR_DB_TYPE: 'postgres',
    PULSARR_POSTGRES_USER: 'app_user',
    PULSARR_POSTGRES_PASSWORD: 'safely-encoded',
    STACKARR_DATABASE_URL: 'postgres://app:s%40fe@database:5432/main?sslmode=verify-full',
    TRACEARR_REDIS_URL: 'redis://redis:6379/0'
  };
  const ts = projectDatabaseEndpoints(env);
  const cjs = shell.project(env);
  for (const key of [
    'PROWLARR_POSTGRES_HOST',
    'PROWLARR_POSTGRES_PORT',
    'ROMM_DB_HOST',
    'ROMM_DB_PORT',
    'PULSARR_DB_HOST',
    'PULSARR_DB_PORT',
    'PULSARR_DB_USER',
    'PULSARR_DB_PASSWORD',
    'IMMICH_DB_HOSTNAME',
    'IMMICH_DB_PORT',
    'IMMICH_REDIS_HOST',
    'IMMICH_REDIS_PORT',
    'TRACEARR_REDIS_URL',
    'STACKARR_DATABASE_URL',
    'YOUTARR_DB_HOST',
    'YOUTARR_DB_PORT'
  ])
    assert.equal(ts[key], cjs[key], key);
  assert.match(ts.STACKARR_DATABASE_URL, /sslmode=verify-full/);
});

test('managed projections reject retained client and URL ports in both runtimes', () => {
  const patches: Array<Record<string, string>> = [
    { IMMICH_DB_PORT: '5544' },
    { ROMM_DB_PORT: '5544' },
    { SEERR_POSTGRES_PORT: '5544' },
    { IMMICH_REDIS_PORT: '6388' },
    { YOUTARR_DB_PORT: '3307' },
    { TRACEARR_DATABASE_URL: 'postgres://app:fixture@database:5544/app' },
    { TRACEARR_REDIS_URL: 'redis://redis:6388' }
  ];
  for (const patch of patches) {
    const env = { ...managedEnvDefaults, ...patch };
    assert.throws(() => projectDatabaseEndpoints(env), /port|5432|6379|3306/);
    assert.throws(() => shell.project(env), /port|5432|6379|3306/);
  }
});

test('TS and shell reject contradictory retained managed selectors', () => {
  const env = { ...managedEnvDefaults, POSTGRES_DEPLOYMENT_MODE: 'managed', POSTGRES_HOST: 'old.example.invalid' };
  assert.throws(() => projectDatabaseEndpoints(env));
  assert.throws(() => shell.project(env));
  const unsupported = { ...managedEnvDefaults, POSTGRES_DEPLOYMENT_MODE: 'bundled' };
  assert.throws(() => projectDatabaseEndpoints(unsupported));
  assert.throws(() => shell.project(unsupported));
});
