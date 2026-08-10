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

test('Youtarr MCP actions authenticate once, return focused data, and queue one exact video', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-youtarr-mcp-test-'));
  let loginCount = 0;
  let downloadBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

    response.setHeader('content-type', 'application/json');
    if (requestUrl.pathname === '/api/health') {
      response.end(JSON.stringify({ status: 'healthy', version: 'fixture' }));
    } else if (requestUrl.pathname === '/api/db-status') {
      response.end(JSON.stringify({ status: 'connected', database: 'youtarr' }));
    } else if (requestUrl.pathname === '/auth/login') {
      loginCount += 1;
      assert.deepEqual(body, { username: 'stackarr-user', password: 'stackarr-password' });
      response.end(JSON.stringify({ token: 'youtarr-token' }));
    } else if (request.headers['x-access-token'] !== 'youtarr-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
    } else if (requestUrl.pathname === '/getVideos') {
      response.end(
        JSON.stringify({
          total: 1,
          videos: [
            {
              id: 7,
              youtubeId: 'dQw4w9WgXcQ',
              youTubeVideoName: 'Example Video',
              youTubeChannelName: 'Example Channel',
              originalDate: '20260808',
              timeCreated: '2026-08-08T23:00:00.000Z',
              duration: 212,
              video_resolution: '1080',
              file_path: '/secret/library/example.mp4',
              thumbnail_url: 'https://secret.example/thumbnail.jpg'
            }
          ]
        })
      );
    } else if (requestUrl.pathname === '/api/videos/download' && request.method === 'POST') {
      downloadBody = body;
      response.end(
        JSON.stringify({ success: true, message: 'queued', video: { title: 'Example Video', duration: 212 } })
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
            getYoutarrHealthAction,
            getYoutarrVideosAction,
            queueYoutarrDownloadAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');

          writeEnvConfig({
            ENABLE_YOUTARR: 'true',
            YOUTARR_URL: 'http://127.0.0.1:${address.port}',
            YOUTARR_ADMIN_USERNAME: 'stackarr-user',
            YOUTARR_ADMIN_PASSWORD: 'stackarr-password'
          });

          const health = await getYoutarrHealthAction();
          const library = await getYoutarrVideosAction({ page: 1, limit: 5 });
          const queued = await queueYoutarrDownloadAction({
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            resolution: '1080',
            subfolder: 'Channel Name'
          });
          let rejected = false;
          try {
            await queueYoutarrDownloadAction({ url: 'https://example.com/watch?v=dQw4w9WgXcQ' });
          } catch {
            rejected = true;
          }
          const catalog = getMcpToolCatalog({ profile: 'manage', enabledServices: ['youtarr'] })
            .filter((tool) => tool.name.includes('youtarr'))
            .map((tool) => ({ name: tool.name, risk: tool.risk }));
          const disabledCatalog = getMcpToolCatalog({ profile: 'manage', enabledServices: [] })
            .filter((tool) => tool.name.includes('youtarr'));
          console.log(JSON.stringify({ health, library, queued, rejected, catalog, disabledCatalog }));
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
    assert.equal(result.health.app.status, 'healthy');
    assert.equal(result.health.database.status, 'connected');
    assert.equal(result.library.total, 1);
    assert.equal(result.library.videos[0].title, 'Example Video');
    assert.equal('filePath' in result.library.videos[0], false);
    assert.doesNotMatch(stdout, /secret\.example|secret\/library/);
    assert.equal(result.queued.queued, true);
    assert.equal(result.rejected, true);
    assert.deepEqual(result.catalog, [
      { name: 'stackarr_get_youtarr_health', risk: 'read' },
      { name: 'stackarr_get_youtarr_videos', risk: 'read' },
      { name: 'stackarr_queue_youtarr_download', risk: 'write' }
    ]);
    assert.deepEqual(result.disabledCatalog, []);
    assert.deepEqual(downloadBody, {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      resolution: '1080',
      subfolder: 'Channel Name'
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  }
});
