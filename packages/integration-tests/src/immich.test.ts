import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('Immich configure provisions a scoped Stackarr agent key after owner setup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-immich-configure-'));
  const keyOutput = path.join(root, 'immich-api-key');
  const requests: Array<{
    method?: string;
    path?: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }> = [];
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    requests.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: rawBody ? JSON.parse(rawBody) : undefined
    });
    response.setHeader('content-type', 'application/json');

    if (request.method === 'POST' && request.url === '/api/auth/login') {
      response.writeHead(201);
      response.end(JSON.stringify({ accessToken: 'fixture-session' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/api-keys') {
      response.end('[]');
      return;
    }
    if (request.method === 'POST' && request.url === '/api/api-keys') {
      response.writeHead(201);
      response.end(JSON.stringify({ apiKey: { id: 'key-id', name: 'Stackarr Agent' }, secret: 'fixture-agent-key' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/server/about') {
      response.end(JSON.stringify({ version: '2.7.5' }));
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await execFile('python3', [path.join(repoRoot, 'stackarr/scripts/immich-configure.py')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        IMMICH_URL: `http://127.0.0.1:${address.port}`,
        IMMICH_ADMIN_EMAIL: 'owner@example.invalid',
        IMMICH_ADMIN_PASSWORD: 'fixture-password',
        IMMICH_API_KEY_OUTPUT: keyOutput
      }
    });

    assert.equal(await readFile(keyOutput, 'utf8'), 'fixture-agent-key');
    const create = requests.find((request) => request.method === 'POST' && request.path === '/api/api-keys');
    assert.deepEqual(create?.body, {
      name: 'Stackarr Agent',
      permissions: ['job.read', 'library.read', 'library.update', 'server.about', 'server.statistics', 'server.storage']
    });
    assert.equal(create?.headers['x-immich-user-token'], 'fixture-session');
    const validation = requests.find((request) => request.path === '/api/server/about');
    assert.equal(validation?.headers['x-api-key'], 'fixture-agent-key');
  } finally {
    if (server.listening) server.close();
    await rm(root, { recursive: true, force: true });
  }
});
