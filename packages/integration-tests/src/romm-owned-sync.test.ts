import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('RomM owned-library sync uses filesystem presence and IGDB identity without guessing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-romm-owned-sync-'));
  const libraryRoot = path.join(root, 'library');
  await mkdir(path.join(libraryRoot, 'roms/nes'), { recursive: true });
  await mkdir(path.join(libraryRoot, 'roms/genesis'), { recursive: true });
  await mkdir(path.join(libraryRoot, 'roms/ps2'), { recursive: true });
  await writeFile(path.join(libraryRoot, 'roms/nes/existing.nes'), 'existing');
  await writeFile(path.join(libraryRoot, 'roms/genesis/new.gen'), 'new');
  await writeFile(path.join(libraryRoot, 'roms/ps2/review.iso'), 'review');
  const games = [{ id: 'existing', igdbId: 10, title: 'Existing', status: 'wanted' }];
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const requestPath = request.url || '';
    response.setHeader('content-type', 'application/json');
    if (requestPath === '/api/login') {
      response.setHeader('set-cookie', 'romm_session=test-session; Path=/; HttpOnly');
      response.end('{}');
    } else if (requestPath.startsWith('/api/roms?')) {
      response.end(
        JSON.stringify({
          total: 4,
          items: [
            {
              id: 1,
              igdb_id: 10,
              name: 'Existing',
              platform_fs_slug: 'nes',
              full_path: 'roms/nes/existing.nes',
              missing_from_fs: false
            },
            {
              id: 2,
              igdb_id: 20,
              name: 'New Game',
              platform_fs_slug: 'genesis',
              platform_display_name: 'Sega Mega Drive/Genesis',
              full_path: 'roms/genesis/new.gen',
              missing_from_fs: false,
              igdb_metadata: { platforms: [{ name: 'Sega Mega Drive/Genesis' }] }
            },
            {
              id: 3,
              name: 'Needs Review',
              platform_fs_slug: 'ps2',
              full_path: 'roms/ps2/review.iso',
              missing_from_fs: false
            },
            {
              id: 4,
              igdb_id: 30,
              name: 'Missing Game',
              platform_fs_slug: 'psx',
              full_path: 'roms/psx/missing.bin',
              missing_from_fs: false
            }
          ]
        })
      );
    } else if (requestPath === '/api/auth/login') response.end(JSON.stringify({ token: 'questarr-token' }));
    else if (requestPath === '/api/igdb/game/20')
      response.end(JSON.stringify({ id: 20, title: 'New Game', coverUrl: 'https://images.example.test/new-game.jpg' }));
    else if (requestPath === '/api/games?includeHidden=true') response.end(JSON.stringify(games));
    else if (requestPath === '/api/games' && request.method === 'POST') {
      writes.push({ method: 'POST', path: requestPath, body });
      const game = { id: 'new', ...body };
      games.push(game as (typeof games)[number]);
      response.statusCode = 201;
      response.end(JSON.stringify(game));
    } else if (requestPath === '/api/games/existing/status' && request.method === 'PATCH') {
      writes.push({ method: 'PATCH', path: requestPath, body });
      games[0]!.status = 'owned';
      response.end(JSON.stringify(games[0]));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
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
          import { writeEnvConfig } from './packages/core/src/env.ts';
          import { syncRommOwnedGamesAction } from './packages/core/src/actions/questarrRommImport.ts';
          writeEnvConfig({
            ROMM_URL: ${JSON.stringify(baseUrl)},
            QUESTARR_URL: ${JSON.stringify(baseUrl)},
            QUESTARR_ROMM_LIBRARY_ROOT: ${JSON.stringify(libraryRoot)},
            USERNAME: 'test-user',
            PASSWORD: 'test-password'
          });
          const preview = await syncRommOwnedGamesAction({ dryRun: true, limit: 2 });
          const applied = await syncRommOwnedGamesAction({ dryRun: false, limit: 2 });
          console.log(JSON.stringify({ preview, applied }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          ROMM_URL: baseUrl,
          QUESTARR_URL: baseUrl,
          QUESTARR_ROMM_LIBRARY_ROOT: libraryRoot,
          USERNAME: 'test-user',
          PASSWORD: 'test-password'
        }
      }
    );
    const result = JSON.parse(stdout) as Record<string, any>;
    assert.equal(result.preview.romm.indexed, 4);
    assert.equal(result.preview.romm.presentOnFilesystem, 3);
    assert.equal(result.preview.romm.missingFromFilesystem, 1);
    assert.equal(result.preview.romm.uniqueIdentifiedGames, 2);
    assert.equal(result.preview.romm.unidentified, 1);
    assert.equal(result.preview.questarr.pendingMutations, 2);
    assert.deepEqual(
      result.preview.preview.map((item: Record<string, unknown>) => item.action),
      ['mark-owned', 'add-owned']
    );
    assert.equal(result.applied.questarr.processed, 2);
    assert.equal(result.applied.questarr.remaining, 0);
    assert.deepEqual(
      writes.map((write) => ({ method: write.method, path: write.path, status: write.body.status })),
      [
        { method: 'PATCH', path: '/api/games/existing/status', status: 'owned' },
        { method: 'POST', path: '/api/games', status: 'owned' }
      ]
    );
    assert.equal(
      writes.find((write) => write.method === 'POST')?.body.coverUrl,
      'https://images.example.test/new-game.jpg'
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
