import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
type Model = {
  services: Record<
    string,
    { environment: Record<string, string | number>; depends_on?: Record<string, unknown>; profiles?: string[] }
  >;
};

for (const mode of ['managed', 'external', 'independent']) {
  test(`generated ${mode} Compose model routes database clients without a Docker daemon`, async (t) => {
    try {
      await execFile('docker', ['compose', 'version', '--short']);
    } catch {
      t.skip('Docker Compose CLI is required for real model rendering, not a Docker daemon');
      return;
    }
    const root = await mkdtemp(path.join(tmpdir(), 'stackarr-endpoint-render-'));
    try {
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: path.join(root, 'home'),
        TMPDIR: process.env.TMPDIR,
        DOCKER_CONFIG: process.env.DOCKER_CONFIG || path.join(process.env.HOME || '', '.docker'),
        DOCKER_HOST: `unix://${root}/absent.sock`,
        APP_ROOT_DEFAULT_OVERRIDE: path.join(root, 'app'),
        APP_ROOT: path.join(root, 'app'),
        CONFIG_ROOT: path.join(root, 'app/config'),
        STATE_ROOT: path.join(root, 'app/state'),
        LOG_ROOT: path.join(root, 'app/logs'),
        STACKARR_DATABASE_FILE: path.join(root, 'app/state/stackarr.db'),
        STACKARR_DATABASE_URL: '',
        STACKARR_DATABASE_MODE: 'app-default',
        STACKARR_RUNTIME: 'native',
        STACKARR_COMPOSE_PROJECT_DIR: path.join(root, 'compose'),
        STACKARR_STORAGE_POLICY: '',
        COMPOSE_PROJECT_NAME: 'endpoint-render-fixture',
        PASSWORD: 'fixture-not-a-secret',
        POSTGRES_DEPLOYMENT_MODE: mode,
        REDIS_DEPLOYMENT_MODE: mode,
        YOUTARR_DATABASE_DEPLOYMENT_MODE: mode,
        STACKARR_IMAGE: 'endpoint-render-fixture:unpublished'
      };
      if (mode !== 'managed') {
        Object.assign(env, {
          POSTGRES_HOST: 'pg.example.invalid',
          POSTGRES_PORT: '15432',
          REDIS_HOST: 'redis.example.invalid',
          REDIS_PORT: '16379',
          YOUTARR_DB_HOST: 'mysql.example.invalid',
          YOUTARR_DB_PORT: '13306'
        });
      } else {
        env.TRACEARR_REDIS_URL = 'redis://:fixture-not-a-secret@redis:6379';
      }
      const { stdout } = await execFile(
        'bash',
        [
          '-c',
          'set -e; source "$1"; load_env; write_compose_env_file; stackarr_compose --profile "*" config --format json',
          'render',
          path.join(repo, 'stackarr/lib/common.sh')
        ],
        { cwd: repo, env, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 }
      );
      const { services } = JSON.parse(stdout) as Model;
      const external = mode !== 'managed';
      const managedDependencies = new Set(['database', 'redis', 'youtarr-db']);
      for (const service of ['immich', 'youtarr']) {
        assert.equal(
          Object.keys(services[service].depends_on || {}).some((key) => managedDependencies.has(key)),
          !external
        );
      }
      assert.equal(services.immich.environment.DB_HOSTNAME, external ? 'pg.example.invalid' : 'database');
      assert.equal(String(services.immich.environment.DB_PORT), external ? '15432' : '5432');
      assert.equal(services.immich.environment.REDIS_HOSTNAME, external ? 'redis.example.invalid' : 'redis');
      assert.equal(String(services.immich.environment.REDIS_PORT), external ? '16379' : '6379');
      assert.equal(String(services.seerr.environment.DB_PORT), external ? '15432' : '5432');
      assert.equal(services.youtarr.environment.DB_HOST, external ? 'mysql.example.invalid' : 'youtarr-db');
      assert.equal(String(services.youtarr.environment.DB_PORT), external ? '13306' : '3306');
      if (external) {
        assert.deepEqual(services.database.profiles, ['stackarr-retained-postgres']);
        assert.deepEqual(services.redis.profiles, ['stackarr-retained-redis']);
        assert.deepEqual(services['youtarr-db'].profiles, ['stackarr-retained-mariadb']);
      }
      const snapshot = await readFile(path.join(root, 'compose/.env'), 'utf8');
      assert.match(snapshot, new RegExp(`POSTGRES_DEPLOYMENT_MODE="${mode}"`));
      assert.match(snapshot, new RegExp(`REDIS_DEPLOYMENT_MODE="${mode}"`));
      assert.doesNotMatch(snapshot, /fixture-not-a-secret|TRACEARR_REDIS_URL=/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
