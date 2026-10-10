import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const loader = path.join(repo, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');
const execFile = promisify(execFileCallback);

test('generic status and diagnostic aliases share native probes, not HTML roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-status-probes-'));
  const requests: string[] = [];
  let rejectAuth = false;
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(url);
    response.setHeader('content-type', 'application/json');
    if (url === '/api/') {
      if (request.headers.authorization === 'Bearer fixture-token' && !rejectAuth) {
        response.end(JSON.stringify({ message: 'API running.' }));
      } else {
        response.statusCode = 401;
        response.end('{}');
      }
    } else if (url === '/api/version') {
      response.statusCode = 401;
      response.end('{}');
    } else if (url === '/api/login') {
      if (rejectAuth) response.statusCode = 401;
      else response.setHeader('set-cookie', 'session=fixture-cookie; HttpOnly');
      response.end('{}');
    } else if (url === '/api/profile') {
      assert.equal(request.headers.cookie, 'session=fixture-cookie');
      response.end(JSON.stringify({ username: 'admin', role: 'admin' }));
    } else if (url === '/api/health') {
      response.end(JSON.stringify({ healthy: !rejectAuth }));
    } else {
      response.setHeader('content-type', 'text/html');
      response.end('<html>Application login</html>');
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const run = (token: string) =>
      execFile(
        process.execPath,
        [
          '--import',
          loader,
          '--input-type=module',
          '-e',
          `
      const { writeEnvConfig } = await import('./packages/core/src/env.ts');
      const { getServiceStatusAction } = await import('./packages/core/src/actions/services.ts');
      const { diagnoseServiceAction, testServiceApiAction, testServiceConnectivityAction } = await import('./packages/core/src/actions/health.ts');
      writeEnvConfig({ ENABLE_HOMEASSISTANT: 'true', ENABLE_FRIGATE: 'true', ENABLE_YOUTARR: 'true',
        HOMEASSISTANT_URL: ${JSON.stringify(base)}, FRIGATE_URL: ${JSON.stringify(base)}, YOUTARR_URL: ${JSON.stringify(base)},
        HOMEASSISTANT_TOKEN: ${JSON.stringify(token)}, USERNAME: 'admin', PASSWORD: 'fixture-password' });
      const actions = [getServiceStatusAction, diagnoseServiceAction, testServiceApiAction, testServiceConnectivityAction];
      const results = [];
      for (const action of actions) for (const service of ['homeassistant', 'frigate', 'youtarr']) results.push(await action({service}));
      console.log(JSON.stringify(results));
    `
        ],
        {
          cwd: repo,
          env: {
            ...process.env,
            STACKARR_DATABASE_URL: '',
            STACKARR_DATABASE_FILE: path.join(root, 'state.db'),
            HOMEASSISTANT_TOKEN: ''
          }
        }
      );
    const good = await run('fixture-token');
    for (const result of JSON.parse(good.stdout)) {
      assert.equal(result.reachable, true);
      assert.equal(result.healthStatus, 'healthy');
      assert.equal(result.healthy, true);
      if (result.name !== 'youtarr') assert.equal(result.authentication, 'verified');
    }
    const missing = await run('');
    for (const result of JSON.parse(missing.stdout).filter((item: { name: string }) => item.name === 'homeassistant')) {
      assert.equal(result.reachable, true);
      assert.equal(result.healthy, false);
      assert.equal(result.authentication, 'notConfigured');
      assert.equal(result.unsupported, true);
    }
    rejectAuth = true;
    const bad = await run('fixture-token');
    for (const result of JSON.parse(bad.stdout)) {
      assert.equal(result.reachable, true);
      assert.equal(result.healthy, false);
      assert.equal(result.healthStatus, 'issues');
      assert.ok(result.issues.length);
      if (result.name !== 'youtarr') assert.equal(result.authentication, 'failed');
    }
    assert.ok(!requests.includes('/'), 'HTML homepage must never be used as an API probe');
    assert.doesNotMatch(good.stdout + missing.stdout + bad.stdout, /fixture-token|fixture-password|fixture-cookie/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
