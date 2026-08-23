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

test('Prowlarr indexer tests run per enabled indexer and return compact results', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-indexer-test-'));
  const tested: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && url.pathname === '/api/v1/indexer') {
      response.end(
        JSON.stringify([
          { id: 1, name: 'YTS', enable: true, fields: [] },
          { id: 2, name: 'Disabled', enable: false, fields: [] }
        ])
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/indexer/test') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { name: string };
      tested.push(body.name);
      response.end('{}');
      return;
    }
    response.statusCode = 404;
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
          const { testIndexersAction } = await import('./packages/core/src/actions/releases.ts');
          writeEnvConfig({
            CONFIG_ROOT: ${JSON.stringify(path.join(root, 'config'))},
            PROWLARR_URL: ${JSON.stringify(baseUrl)},
            PROWLARR_API_KEY: 'indexer-test-secret'
          });
          console.log(JSON.stringify(await testIndexersAction()));
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
    assert.deepEqual(tested, ['YTS']);
    assert.deepEqual(result, {
      tested: 1,
      passed: 1,
      failed: 0,
      results: [{ id: 1, name: 'YTS', status: 'passed' }]
    });
    assert.doesNotMatch(stdout, /indexer-test-secret/);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('App health summary groups Arr issues and isolates unavailable apps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-health-test-'));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/v1/health') {
      response.end(
        JSON.stringify([{ source: 'IndexerStatusCheck', type: 'warning', message: 'Indexer is unavailable' }])
      );
      return;
    }
    if (url.pathname === '/api/v3/health' && request.headers['x-api-key'] === 'radarr-secret') {
      response.end('[]');
      return;
    }
    if (url.pathname === '/api/v3/health' && request.headers['x-api-key'] === 'sonarr-secret') {
      response.statusCode = 401;
      response.end(JSON.stringify({ message: 'API key sonarr-secret is invalid' }));
      return;
    }
    if (url.pathname === '/api/health') {
      response.statusCode = 401;
      response.end(JSON.stringify({ message: 'Authentication required' }));
      return;
    }
    response.statusCode = 404;
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
          const { getAppHealthSummaryAction } = await import('./packages/core/src/actions/health.ts');
          writeEnvConfig({
            CONFIG_ROOT: ${JSON.stringify(path.join(root, 'config'))},
            ENABLE_MOVIES: 'true',
            ENABLE_TV_SHOWS: 'true',
            PROWLARR_URL: ${JSON.stringify(baseUrl)},
            PROWLARR_API_KEY: 'prowlarr-secret',
            RADARR_URL: ${JSON.stringify(baseUrl)},
            RADARR_API_KEY: 'radarr-secret',
            SONARR_URL: ${JSON.stringify(baseUrl)},
            SONARR_API_KEY: 'sonarr-secret',
            ENABLE_CLEANUPARR: 'true',
            CLEANUPARR_URL: ${JSON.stringify(baseUrl)},
            ENABLE_LIDARR: 'false'
          });
          console.log(JSON.stringify(await getAppHealthSummaryAction()));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_URL: '',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          ENABLE_MOVIES: 'true',
          ENABLE_TV_SHOWS: 'true',
          ENABLE_CLEANUPARR: 'true',
          ENABLE_LIDARR: 'false'
        }
      }
    );

    const summary = JSON.parse(stdout);
    const byService = Object.fromEntries(summary.checks.map((check: { service: string }) => [check.service, check]));
    assert.equal(byService.prowlarr.status, 'issues');
    assert.deepEqual(byService.prowlarr.issues, [
      { severity: 'warning', source: 'IndexerStatusCheck', message: 'Indexer is unavailable' }
    ]);
    assert.equal(byService.radarr.status, 'healthy');
    assert.equal(byService.sonarr.status, 'unavailable');
    assert.equal(byService.cleanuparr.status, 'healthy');
    assert.ok(summary.issueCount >= 2);
    assert.doesNotMatch(stdout, /prowlarr-secret|radarr-secret|sonarr-secret/);
    assert.doesNotMatch(stdout, /http:\/\/127\.0\.0\.1/);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
