import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const configureScript = path.join(repoRoot, 'stackarr/scripts/questarr-configure.cjs');

test('Questarr configuration shares IGDB and wires Prowlarr plus downloads without post-processing', async () => {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown>; authorization?: string }> = [];
  let serverBaseUrl = '';
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const requestPath = request.url || '';

    requests.push({
      method: request.method || '',
      path: requestPath,
      body,
      authorization: request.headers.authorization
    });

    response.setHeader('content-type', 'application/json');
    if (requestPath === '/api/auth/status') response.end(JSON.stringify({ hasUsers: false }));
    else if (requestPath === '/api/auth/setup') response.end(JSON.stringify({ token: 'questarr-token' }));
    else if (requestPath === '/api/indexers/prowlarr/sync') {
      response.end(JSON.stringify({ success: true, results: { added: 2, updated: 0 } }));
    } else if (requestPath === '/api/v1/tag') {
      response.end(JSON.stringify([{ id: 2, label: 'games' }]));
    } else if (requestPath === '/api/v1/indexer') {
      response.end(
        JSON.stringify([
          { id: 7, name: 'Internet Archive (Games)', enable: true, tags: [2] },
          { id: 6, name: '1337x', enable: true, tags: [1] },
          { id: 5, name: 'Internet Archive', enable: false, tags: [2] }
        ])
      );
    } else if (requestPath === '/api/indexers' && request.method === 'GET') {
      response.end(
        JSON.stringify([
          { id: 'ia-games', url: `${serverBaseUrl}/7/api`, enabled: true },
          { id: '1337x', url: `${serverBaseUrl}/6/api`, enabled: true },
          { id: 'ia-old', url: `${serverBaseUrl}/5/api`, enabled: false }
        ])
      );
    } else if (requestPath === '/api/indexers/1337x' && request.method === 'PATCH') {
      response.end(JSON.stringify({ id: '1337x', enabled: false }));
    } else if (requestPath === '/api/downloaders/test') {
      response.end(JSON.stringify({ success: true, message: 'connected' }));
    } else if (requestPath === '/api/downloaders' && request.method === 'GET') response.end('[]');
    else if (requestPath === '/api/downloaders' && request.method === 'POST') {
      response.statusCode = 201;
      response.end(JSON.stringify({ id: 'downloader-1', ...body }));
    } else if (requestPath === '/api/imports/config' && request.method === 'PATCH') {
      response.end(JSON.stringify({ enablePostProcessing: false }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    serverBaseUrl = `http://127.0.0.1:${address.port}`;
    const { stdout } = await execFile(process.execPath, [configureScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        QUESTARR_WEB_PORT: String(address.port),
        PROWLARR_CONFIGURE_URL: serverBaseUrl,

        USERNAME: 'stackarr-user',
        PASSWORD: 'stackarr-password',
        QUESTARR_IGDB_CLIENT_ID: 'shared-client',
        QUESTARR_IGDB_CLIENT_SECRET: 'shared-secret',
        PROWLARR_API_KEY: 'prowlarr-key',
        PREFERRED_TORRENT_CLIENT: 'transmission',
        TRANSMISSION_PASSWORD: 'transmission-password',
        DOWNLOAD_COMPLETE_NAME: 'complete'
      }
    });

    assert.match(
      stdout,
      /account created, Prowlarr indexers 2 added\/0 updated, game sources 1 enabled\/2 excluded, Stackarr Transmission connected/
    );
    assert.match(stdout, /Secure RomM import remains disabled/);

    const setup = requests.find((request) => request.path === '/api/auth/setup');
    assert.deepEqual(setup?.body, {
      username: 'stackarr-user',
      password: 'stackarr-password',
      igdbClientId: 'shared-client',
      igdbClientSecret: 'shared-secret'
    });

    const prowlarr = requests.find((request) => request.path === '/api/indexers/prowlarr/sync');
    assert.equal(prowlarr?.body.url, serverBaseUrl);
    assert.equal(typeof prowlarr?.body.apiKey, 'string');
    assert.equal(prowlarr?.authorization, 'Bearer questarr-token');

    const disabledNonGameSource = requests.find(
      (request) => request.path === '/api/indexers/1337x' && request.method === 'PATCH'
    );
    assert.deepEqual(disabledNonGameSource?.body, { enabled: false });
    assert.equal(
      requests.some((request) => request.path === '/api/indexers/ia-old' && request.method === 'PATCH'),
      false
    );

    const downloader = requests.find((request) => request.path === '/api/downloaders' && request.method === 'POST');
    assert.equal(downloader?.body.url, 'http://transmission');
    assert.equal(downloader?.body.port, 9091);
    assert.equal(downloader?.body.downloadPath, '/downloads/complete');
    assert.equal(downloader?.body.postImportCategory, '');
    assert.equal(downloader?.body.removeCompleted, false);

    assert.equal(
      requests.some((request) => request.path === '/api/settings'),
      false
    );

    const importConfig = requests.find(
      (request) => request.path === '/api/imports/config' && request.method === 'PATCH'
    );
    assert.deepEqual(importConfig?.body, { enablePostProcessing: false });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
