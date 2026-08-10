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

test('Questarr MCP actions stay focused, hide release links, and use the configured downloader', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-questarr-mcp-test-'));
  let loginCount = 0;
  let downloadBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

    response.setHeader('content-type', 'application/json');
    if (requestUrl.pathname === '/api/auth/login') {
      loginCount += 1;
      response.end(JSON.stringify({ token: 'questarr-token' }));
    } else if (request.headers.authorization !== 'Bearer questarr-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
    } else if (requestUrl.pathname === '/api/igdb/search') {
      response.end(
        JSON.stringify([
          {
            id: 42,
            name: 'Example Game',
            releaseDate: '2026-01-02',
            rating: 8.5,
            platforms: ['PC'],
            genres: ['Adventure']
          }
        ])
      );
    } else if (requestUrl.pathname === '/api/search') {
      response.end(
        JSON.stringify({
          total: 1,
          items: [
            {
              title: 'Example.Game.v1.0',
              indexerName: 'Games Indexer',
              protocol: 'torznab',
              link: 'http://indexer.invalid/download?id=1&apikey=secret-value',
              size: 1024,
              seeders: 12,
              leechers: 2
            }
          ],
          errors: ['one indexer unavailable']
        })
      );
    } else if (requestUrl.pathname === '/api/downloads' && request.method === 'GET') {
      response.end(
        JSON.stringify({
          downloads: [
            {
              id: 'download-1',
              name: 'Example.Game.v1.0',
              status: 'downloading',
              progress: 25,
              downloaderName: 'Stackarr Transmission',
              trackedByQuestarr: true
            }
          ],
          errors: []
        })
      );
    } else if (requestUrl.pathname === '/api/downloads' && request.method === 'POST') {
      downloadBody = body;
      response.end(
        JSON.stringify({
          success: true,
          downloaderId: 'transmission-1',
          id: 'download-2',
          message: 'Download started'
        })
      );
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const {
            getMcpToolCatalog,
            getQuestarrDownloadsAction,
            searchQuestarrGamesAction,
            searchQuestarrReleasesAction,
            startQuestarrDownloadAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');

          writeEnvConfig({
            ENABLE_QUESTARR: 'true',
            QUESTARR_URL: 'http://127.0.0.1:${address.port}',
            USERNAME: 'stackarr-user',
            PASSWORD: 'stackarr-password'
          });

          const game = await searchQuestarrGamesAction({ query: 'Example', limit: 5 });
          const releases = await searchQuestarrReleasesAction({ query: 'Example Game', limit: 5 });
          const downloads = await getQuestarrDownloadsAction({ limit: 5 });
          const started = await startQuestarrDownloadAction({
            query: 'Example Game',
            releaseTitle: 'Example.Game.v1.0',
            indexerName: 'Games Indexer'
          });
          const catalog = getMcpToolCatalog({ profile: 'manage', enabledServices: ['questarr'] })
            .filter((tool) => tool.name.includes('questarr'))
            .map((tool) => ({ name: tool.name, risk: tool.risk }));
          const disabledCatalog = getMcpToolCatalog({ profile: 'manage', enabledServices: [] })
            .filter((tool) => tool.name.includes('questarr'));
          console.log(JSON.stringify({ game, releases, downloads, started, catalog, disabledCatalog }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );
    const result = JSON.parse(stdout) as Record<string, any>;

    assert.equal(loginCount, 1);
    assert.equal(result.game.results[0].title, 'Example Game');
    assert.equal(result.releases.results[0].title, 'Example.Game.v1.0');
    assert.equal(result.releases.errors, 1);
    assert.equal('link' in result.releases.results[0], false);
    assert.doesNotMatch(stdout, /secret-value/);
    assert.equal(result.downloads.downloads[0].trackedByQuestarr, true);
    assert.equal(result.started.started, true);
    assert.deepEqual(result.catalog, [
      { name: 'stackarr_search_questarr_games', risk: 'read' },
      { name: 'stackarr_search_questarr_releases', risk: 'read' },
      { name: 'stackarr_get_questarr_downloads', risk: 'read' },
      { name: 'stackarr_start_questarr_download', risk: 'write' }
    ]);
    assert.deepEqual(result.disabledCatalog, []);
    assert.deepEqual(downloadBody, {
      url: 'http://indexer.invalid/download?id=1&apikey=secret-value',
      title: 'Example.Game.v1.0'
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  }
});
