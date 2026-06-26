import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const stateDir = mkdtempSync(path.join(tmpdir(), 'stackarr-downloads-test-'));
process.env.STACKARR_DATABASE_FILE = path.join(stateDir, 'stackarr.db');

function core() {
  return import('../../core/src/index.ts');
}

async function writeRuntimeConfig(config: Record<string, string>) {
  const { writeEnvConfig } = await core();
  writeEnvConfig(config);
}

test('Transmission add magnet handles session retry and credentials', async () => {
  const seen: { auth?: string; session?: string; body?: unknown }[] = [];
  const server = await startServer(async (request, response) => {
    assert.equal(request.url, '/transmission/rpc');
    seen.push({
      auth: request.headers.authorization,
      session: request.headers['x-transmission-session-id'] as string | undefined,
      body: JSON.parse(await body(request))
    });

    if (seen.length === 1) {
      response.writeHead(409, { 'X-Transmission-Session-Id': 'session-1' });
      response.end();
      return;
    }

    json(response, {
      result: 'success',
      arguments: {
        'torrent-added': { id: 42, hashString: 'abc123', name: 'Ubuntu ISO' }
      }
    });
  });

  try {
    const { addMagnetAction } = await core();
    await writeRuntimeConfig({ TRANSMISSION_URL: server.url, USERNAME: 'stackarr', PASSWORD: 'secret' });
    const result = await addMagnetAction({
      downloader: 'transmission',
      magnet: 'magnet:?xt=urn:btih:abc123&dn=Ubuntu'
    });

    assert.equal(result.accepted, true);
    assert.equal(result.id, '42');
    assert.equal(result.hash, 'abc123');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].auth, `Basic ${Buffer.from('stackarr:secret').toString('base64')}`);
    assert.equal(seen[1].session, 'session-1');
    assert.deepEqual(seen[1].body, {
      method: 'torrent-add',
      arguments: { filename: 'magnet:?xt=urn:btih:abc123&dn=Ubuntu' }
    });
  } finally {
    await server.close();
  }
});

test('Transmission queue and write operations call the expected RPC methods', async () => {
  const methods: string[] = [];
  const server = await startServer(async (request, response) => {
    const payload = JSON.parse(await body(request));
    methods.push(payload.method);

    if (payload.method === 'torrent-get') {
      json(response, {
        result: 'success',
        arguments: {
          torrents: [
            { id: 1, name: 'Active', status: 4, percentDone: 0.25, rateDownload: 2048, addedDate: 1710000000 },
            { id: 2, name: 'Done', status: 6, percentDone: 1, doneDate: 1710000300 }
          ]
        }
      });
      return;
    }

    json(response, { result: 'success' });
  });

  try {
    const {
      getDownloadQueueAction,
      pauseDownloadAction,
      resumeDownloadAction,
      removeDownloadAction,
      setDownloadPriorityAction
    } = await core();
    await writeRuntimeConfig({ TRANSMISSION_URL: `${server.url}/transmission/rpc` });

    const queue = await getDownloadQueueAction({ downloader: 'transmission' });
    await pauseDownloadAction({ downloader: 'transmission', id: '1' });
    await resumeDownloadAction({ downloader: 'transmission', id: '1' });
    await setDownloadPriorityAction({ downloader: 'transmission', id: '1', priority: 9 });
    await removeDownloadAction({ downloader: 'transmission', id: '1', deleteData: false });

    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].status, 'downloading');
    assert.deepEqual(methods, ['torrent-get', 'torrent-stop', 'torrent-start', 'torrent-set', 'torrent-remove']);
  } finally {
    await server.close();
  }
});

test('qBittorrent add torrent URL logs in and posts form data', async () => {
  const calls: { url?: string; body?: string; cookie?: string }[] = [];
  const server = await startServer(async (request, response) => {
    calls.push({
      url: request.url,
      body: await body(request),
      cookie: request.headers.cookie
    });

    if (request.url === '/api/v2/auth/login') {
      response.writeHead(200, { 'Set-Cookie': 'SID=qbit-session; Path=/' });
      response.end('Ok.');
      return;
    }

    response.end('Ok.');
  });

  try {
    const { addTorrentUrlAction } = await core();
    await writeRuntimeConfig({ QBITTORRENT_URL: server.url, USERNAME: 'stackarr', PASSWORD: 'secret' });
    const result = await addTorrentUrlAction({ downloader: 'qbittorrent', url: 'https://example.test/file.torrent' });

    assert.equal(result.accepted, true);
    assert.equal(calls[0].url, '/api/v2/auth/login');
    assert.equal(calls[0].body, 'username=stackarr&password=secret');
    assert.equal(calls[1].url, '/api/v2/torrents/add');
    assert.equal(calls[1].cookie, 'SID=qbit-session');
    assert.equal(calls[1].body, 'urls=https%3A%2F%2Fexample.test%2Ffile.torrent');
  } finally {
    await server.close();
  }
});

function startServer(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}

function body(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, data: unknown) {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(data));
}
