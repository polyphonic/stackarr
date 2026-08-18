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
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('media search reconciliation stays manual and bounded', async () => {
  const scheduler = await readFile(path.join(repoRoot, 'stackarr/scripts/scheduler.sh'), 'utf8');
  const cli = await readFile(path.join(repoRoot, 'stackarr/bin/stackarr'), 'utf8');
  assert.doesNotMatch(scheduler, /media-reconcile run/);
  assert.doesNotMatch(scheduler, /media-search-reconciliation/);
  assert.match(cli, /media-reconcile[\s\S]*media-reconcile run/);
});

test('media search reconciliation retries only recent missing items without an active download', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-media-reconcile-'));
  const commands: Array<{ name?: string; movieIds?: number[]; seriesIds?: number[] }> = [];
  const now = new Date('2026-08-15T12:00:00.000Z');
  const added = new Date(now.getTime() - 30 * 60_000).toISOString();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');

    if (request.method === 'GET' && url.pathname === '/api/v3/wanted/missing') {
      if (url.searchParams.get('apikey') === 'sonarr-secret') {
        response.end(
          JSON.stringify({
            records: [
              {
                id: 20,
                seriesId: 30,
                monitored: true,
                hasFile: false,
                airDateUtc: '2026-08-01T00:00:00.000Z',
                series: { id: 30, added, monitored: true }
              },
              {
                id: 21,
                seriesId: 31,
                monitored: true,
                hasFile: false,
                airDateUtc: '2026-08-01T00:00:00.000Z',
                series: { id: 31, added, monitored: true }
              },
              {
                id: 22,
                seriesId: 32,
                monitored: true,
                hasFile: false,
                airDateUtc: '2026-09-01T00:00:00.000Z',
                series: { id: 32, added, monitored: true }
              }
            ]
          })
        );
      } else {
        response.end(
          JSON.stringify({
            records: [
              { id: 10, monitored: true, hasFile: false, isAvailable: true, added },
              { id: 11, monitored: true, hasFile: false, isAvailable: true, added },
              { id: 12, monitored: true, hasFile: false, isAvailable: false, added }
            ]
          })
        );
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v3/queue') {
      if (url.searchParams.get('apikey') === 'sonarr-secret')
        response.end(JSON.stringify({ records: [{ seriesId: 31, episodeId: 21 }] }));
      else response.end(JSON.stringify({ records: [{ movieId: 11 }] }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v3/series') {
      response.end(
        JSON.stringify([
          { id: 30, added, monitored: true },
          { id: 31, added, monitored: true },
          { id: 32, added, monitored: true }
        ])
      );
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v3/command') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      commands.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.end(JSON.stringify({ id: commands.length, status: 'queued' }));
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
          const { reconcileMediaSearchesAction } = await import('./packages/core/src/actions/mediaReconciliation.ts');
          writeEnvConfig({
            CONFIG_ROOT: ${JSON.stringify(path.join(root, 'config'))},
            ENABLE_MOVIES: 'true',
            ENABLE_TV_SHOWS: 'true',
            RADARR_URL: ${JSON.stringify(baseUrl)},
            RADARR_API_KEY: 'radarr-secret',
            SONARR_URL: ${JSON.stringify(baseUrl)},
            SONARR_API_KEY: 'sonarr-secret'
          });
          const first = await reconcileMediaSearchesAction({ now: ${JSON.stringify(now.toISOString())} });
          const early = await reconcileMediaSearchesAction({ now: '2026-08-15T12:05:00.000Z' });
          const retry = await reconcileMediaSearchesAction({ now: '2026-08-15T13:05:00.000Z' });
          await reconcileMediaSearchesAction({ now: '2026-08-15T19:10:00.000Z' });
          await reconcileMediaSearchesAction({ now: '2026-08-16T19:15:00.000Z' });
          await reconcileMediaSearchesAction({ now: '2026-08-19T19:20:00.000Z' });
          await reconcileMediaSearchesAction({ now: '2026-08-26T19:25:00.000Z' });
          const exhausted = await reconcileMediaSearchesAction({ now: '2026-08-27T19:30:00.000Z' });
          console.log(JSON.stringify({ first, early, retry, exhausted }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_URL: '',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          ENABLE_MOVIES: 'true',
          ENABLE_TV_SHOWS: 'true'
        }
      }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.first.queued, 2);
    assert.equal(result.early.queued, 0);
    assert.equal(result.retry.queued, 2);
    assert.equal(result.exhausted.queued, 0);
    assert.equal(result.exhausted.exhausted, 2);
    assert.equal(commands.length, 12);
    assert.deepEqual(commands[0], { name: 'MoviesSearch', movieIds: [10] });
    assert.deepEqual(commands[1], { name: 'EpisodeSearch', episodeIds: [20] });
    assert.deepEqual(commands.at(-2), { name: 'MoviesSearch', movieIds: [10] });
    assert.deepEqual(commands.at(-1), { name: 'EpisodeSearch', episodeIds: [20] });
    assert.doesNotMatch(stdout, /radarr-secret|sonarr-secret/);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
