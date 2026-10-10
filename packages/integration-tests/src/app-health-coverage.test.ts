import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const loader = path.join(repo, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');
const execFile = promisify(execFileCallback);

test('every registered app/helper has an explicit probe, including disabled options', async () => {
  const { getServices } = await import('../../core/src/services.ts');
  const { appHealthProbes } = await import('../../core/src/actions/health.ts');
  const registered = getServices()
    .filter((service) => service.experience !== 'infrastructure')
    .map((service) => service.name)
    .sort();
  assert.deepEqual(Object.keys(appHealthProbes).sort(), registered);
  assert.ok(Object.values(appHealthProbes).every(Boolean));
});

test('availability-only, CLI readiness, and authenticated Questarr checks never mask failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-probe-'));
  const command = path.join(root, 'rip');
  await writeFile(command, '#!/bin/sh\n[ "$1" = "--version" ]\n', { mode: 0o755 });
  let questarrHealthy = true;
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/auth/login') {
      response.end(JSON.stringify({ token: 'secret-token' }));
    } else if (request.url === '/api/downloads') {
      if (request.headers.authorization !== 'Bearer secret-token' || !questarrHealthy) response.statusCode = 401;
      response.end(JSON.stringify({ downloads: [] }));
    } else if (request.url === '/') {
      response.statusCode = 302;
      response.setHeader('location', '/login');
      response.end('');
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    const script = `
      const { writeEnvConfig } = await import('./packages/core/src/env.ts');
      const { getAppHealthSummaryAction } = await import('./packages/core/src/actions/health.ts');
      writeEnvConfig({ ENABLE_QUESTARR: 'true', ENABLE_TIDARR: 'true', ENABLE_LIDARR: 'true',
        ENABLE_MOVIES: 'false', ENABLE_TV_SHOWS: 'false', QUESTARR_URL: ${JSON.stringify(url)},
        TIDARR_URL: ${JSON.stringify(url)}, STREAMRIP_COMMAND: ${JSON.stringify(command)},
        USERNAME: 'admin', PASSWORD: 'private-password' });
      const summary = await getAppHealthSummaryAction();
      console.log(JSON.stringify(summary.checks.filter((check) => ['questarr', 'tidarr', 'streamrip'].includes(check.service))));
    `;
    const run = () =>
      execFile(process.execPath, ['--import', loader, '--input-type=module', '-e', script], {
        cwd: repo,
        env: { ...process.env, STACKARR_DATABASE_URL: '', STACKARR_DATABASE_FILE: path.join(root, 'state.db') }
      });
    const first = await run();
    const checks = Object.fromEntries(
      JSON.parse(first.stdout).map((item: { service: string }) => [item.service, item])
    );
    assert.equal(checks.questarr.status, 'healthy');
    assert.equal(checks.questarr.scope, 'authenticated');
    assert.equal(checks.tidarr.scope, 'availability');
    assert.equal(checks.tidarr.status, 'unsupported');
    assert.equal(checks.tidarr.availability, 'reachable');
    assert.equal(checks.streamrip.scope, 'cli');
    assert.equal(checks.streamrip.status, 'healthy');
    questarrHealthy = false;
    await writeFile(command, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const second = await run();
    const failures = Object.fromEntries(
      JSON.parse(second.stdout).map((item: { service: string }) => [item.service, item])
    );
    assert.equal(failures.questarr.status, 'unavailable');
    assert.equal(failures.streamrip.status, 'unavailable');
    assert.doesNotMatch(second.stdout, /private-password|secret-token/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
