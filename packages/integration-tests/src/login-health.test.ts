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

test('login-backed health separates availability, verified auth, missing HA token and failed credentials', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-login-health-'));
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    const url = request.url ?? '';
    calls.push(`${request.method} ${url}`);
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && url === '/api/auth/login') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const credentials = JSON.parse(Buffer.concat(chunks).toString());
      if (credentials.password !== 'valid-secret') {
        response.statusCode = 401;
        response.end(JSON.stringify({ message: 'invalid valid-secret' }));
      } else response.end(JSON.stringify({ tokens: { accessToken: 'private-token' } }));
    } else if (request.method === 'POST' && url === '/api/login') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const credentials = JSON.parse(Buffer.concat(chunks).toString());
      if (credentials.password !== 'valid-secret') response.statusCode = 401;
      else response.setHeader('set-cookie', 'frigate_token=private-cookie; HttpOnly; Path=/');
      response.end('');
    } else if (url === '/api/profile') {
      if (request.headers.cookie !== 'frigate_token=private-cookie') response.statusCode = 401;
      response.end(JSON.stringify({ username: 'admin', role: 'admin' }));
    } else if (url === '/api/health') {
      if (request.headers.authorization !== 'Bearer private-token') response.statusCode = 401;
      response.end('{}');
    } else if (url === '/api/') {
      if (request.headers.authorization === 'Bearer ha-valid-token')
        response.end(JSON.stringify({ message: 'API running.' }));
      else {
        response.statusCode = 401;
        response.end('{}');
      }
    } else if (url === '/api/version') {
      response.statusCode = 401;
      response.end('{}');
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
      writeEnvConfig({ ENABLE_CLEANUPARR: 'true', ENABLE_FRIGATE: 'true', ENABLE_HOMEASSISTANT: 'true',
        CLEANUPARR_URL: ${JSON.stringify(url)}, FRIGATE_URL: ${JSON.stringify(url)}, HOMEASSISTANT_URL: ${JSON.stringify(url)},
        USERNAME: 'admin', PASSWORD: 'valid-secret' });
      const first = await getAppHealthSummaryAction();
      writeEnvConfig({ PASSWORD: 'wrong-secret' });
      const second = await getAppHealthSummaryAction();
      process.env.HOMEASSISTANT_TOKEN = 'ha-valid-token';
      const third = await getAppHealthSummaryAction();
      process.env.HOMEASSISTANT_TOKEN = 'ha-invalid-token';
      const fourth = await getAppHealthSummaryAction();
      console.log(JSON.stringify([first, second, third, fourth]));
    `;
    const { stdout } = await promisify(execFileCallback)(
      process.execPath,
      ['--import', loader, '--input-type=module', '-e', script],
      {
        cwd: repo,
        env: { ...process.env, STACKARR_DATABASE_URL: '', STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') }
      }
    );
    const [first, second, third, fourth] = JSON.parse(stdout);
    const check = (summary: any, name: string) => summary.checks.find((item: any) => item.service === name);
    for (const service of ['cleanuparr', 'frigate']) {
      assert.equal(check(first, service).status, 'healthy');
      assert.equal(check(first, service).authentication, 'verified');
      assert.equal(check(second, service).availability, 'reachable');
    }
    assert.equal(check(second, 'cleanuparr').authentication, 'failed');
    assert.equal(check(second, 'cleanuparr').status, 'issues');
    assert.equal(check(second, 'frigate').authentication, 'failed');
    assert.equal(check(second, 'frigate').status, 'issues');
    assert.equal(check(first, 'homeassistant').status, 'unsupported');
    assert.equal(check(first, 'homeassistant').authentication, 'notConfigured');
    assert.equal(check(third, 'homeassistant').authentication, 'verified');
    assert.equal(check(fourth, 'homeassistant').authentication, 'failed');
    assert.ok(calls.includes('GET /api/profile'));
    assert.ok(calls.includes('GET /api/health'));
    assert.doesNotMatch(stdout, /valid-secret|wrong-secret|private-token|private-cookie/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
