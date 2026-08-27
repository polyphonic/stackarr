import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('control-plane health probes use native Lidarr and RomM endpoints and diagnostics stay read-only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-control-plane-health-'));
  const requested: Array<{ method: string; path: string }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requested.push({ method: request.method ?? 'GET', path: url.pathname });

    if (url.pathname === '/api/v1/system/status') {
      assert.equal(url.searchParams.get('apikey'), 'arr-test-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(['lidarr-native-status']));
      return;
    }
    if (url.pathname === '/api/heartbeat') {
      response.setHeader('content-type', 'text/plain');
      response.end('romm-ready');
      return;
    }
    if (url.pathname === '/api/v3/downloadclient') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ enable: true, implementation: 'Transmission' }]));
      return;
    }
    if (url.pathname === '/api/v1/downloadclient') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ enable: true, implementation: 'Transmission' }]));
      return;
    }
    if (url.pathname === '/api/v1/applications') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ name: 'Radarr' }, { name: 'Lidarr' }]));
      return;
    }
    if (url.pathname === '/api/v1/settings/radarr') {
      assert.equal(request.headers['x-api-key'], 'seerr-test-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ id: 1, name: 'Radarr', is4k: false }]));
      return;
    }
    if (url.pathname === '/api/v1/health' || url.pathname === '/api/v3/health') {
      response.setHeader('content-type', 'application/json');
      response.end('[]');
      return;
    }
    if (url.pathname === '/api/v1/status') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ version: 'test' }));
      return;
    }
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json');
    response.end('{}');
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getServiceStatusAction } = await import('./packages/core/src/actions/services.ts');
          const {
            checkServiceDatabasesAction,
            testArrToDownloaderAction,
            testProwlarrToArrAction,
            testSeerrToArrAction
          } = await import('./packages/core/src/actions/health.ts');
          writeEnvConfig({
            CONFIG_ROOT: ${JSON.stringify(path.join(root, 'config'))},
            ENABLE_MOVIES: 'true',
            ENABLE_TV_SHOWS: 'false',
            ENABLE_LIDARR: 'true',
            ENABLE_ROMM: 'true',
            ENABLE_SEERR: 'true',
            ENABLE_BAZARR: 'false',
            ENABLE_PULSARR: 'false',
            PROWLARR_URL: ${JSON.stringify(baseUrl)},
            PROWLARR_API_KEY: 'arr-test-key',
            RADARR_URL: ${JSON.stringify(baseUrl)},
            RADARR_API_KEY: 'arr-test-key',
            LIDARR_URL: ${JSON.stringify(baseUrl)},
            LIDARR_API_KEY: 'arr-test-key',
            ROMM_URL: ${JSON.stringify(baseUrl)},
            SEERR_URL: ${JSON.stringify(baseUrl)},
            SEERR_API_KEY: 'seerr-test-key',
            PREFERRED_TORRENT_CLIENT: 'transmission'
          });
          console.log(JSON.stringify({
            lidarr: await getServiceStatusAction({ service: 'lidarr' }),
            romm: await getServiceStatusAction({ service: 'romm' }),
            databases: await checkServiceDatabasesAction(),
            arrDownloader: await testArrToDownloaderAction(),
            prowlarrArr: await testProwlarrToArrAction(),
            seerrArr: await testSeerrToArrAction()
          }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_URL: '',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.lidarr.reachable, true);
    assert.deepEqual(result.lidarr.response, ['lidarr-native-status']);
    assert.equal(result.romm.reachable, true);
    assert.equal(result.romm.response, 'romm-ready');
    assert.equal(result.databases.status, 'healthy');
    assert.ok(result.databases.checked >= 3);
    assert.equal(result.arrDownloader.status, 'healthy');
    assert.equal(result.prowlarrArr.status, 'healthy');
    assert.equal(result.seerrArr.status, 'healthy');
    assert.ok(result.arrDownloader.results.every((item: { status: string }) => item.status === 'passed'));
    assert.ok(result.prowlarrArr.results.every((item: { status: string }) => item.status === 'passed'));
    assert.ok(result.seerrArr.results.every((item: { status: string }) => item.status === 'passed'));
    assert.ok(requested.some((request) => request.path === '/api/v1/system/status'));
    assert.ok(requested.some((request) => request.path === '/api/heartbeat'));
    assert.ok(requested.some((request) => request.path === '/api/v1/applications'));
    assert.ok(requested.some((request) => request.path === '/api/v1/settings/radarr'));
    assert.ok(requested.every((request) => request.path !== '/api/v1/application'));
    assert.ok(requested.every((request) => request.path !== '/api/v1/settings/services'));
    assert.ok(requested.every((request) => request.method === 'GET'));
    assert.doesNotMatch(stdout, /arr-test-key|seerr-test-key/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});

test('doctor command uses doctor diagnostics rather than database info', async () => {
  const { commandRegistry } = await import('../../core/src/commands.ts');
  assert.deepEqual(commandRegistry.Doctor.args, ['doctor']);
  assert.deepEqual(commandRegistry.DbInfo.args, ['db-info']);
});
