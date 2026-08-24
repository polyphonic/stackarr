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

test('Questarr game requests resolve an exact platform, preserve IGDB payloads, and idempotently persist the RomM mapping', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-questarr-request-game-test-'));
  const postedGames: Record<string, unknown>[] = [];
  let postCount = 0;
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');

    if (requestUrl.pathname === '/api/platforms' && request.headers.authorization === 'Bearer romm-key') {
      response.end(
        JSON.stringify([
          { id: 1, fs_slug: 'n64', name: 'Nintendo 64' },
          { id: 2, fs_slug: 'snes', name: 'Super Nintendo Entertainment System' }
        ])
      );
    } else if (requestUrl.pathname === '/api/auth/login') {
      response.end(JSON.stringify({ token: 'questarr-token' }));
    } else if (request.headers.authorization !== 'Bearer questarr-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
    } else if (requestUrl.pathname === '/api/igdb/search') {
      if (requestUrl.searchParams.get('q') === 'Solo Game') {
        response.end(
          JSON.stringify([
            {
              id: 66,
              name: 'Solo Game',
              platforms: [
                { id: 4, name: 'Nintendo 64' },
                { id: 6, name: 'PC (Microsoft Windows)' }
              ]
            }
          ])
        );
      } else {
        response.end(
          JSON.stringify([
            {
              id: 64,
              name: 'Example Game',
              summary: 'The full selected IGDB payload must survive.',
              cover: { url: 'https://images.igdb.com/example.jpg' },
              platforms: [{ id: 4, name: 'Nintendo 64' }]
            },
            {
              id: 65,
              name: 'Example Game',
              summary: 'A different platform with the same exact title.',
              platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }]
            }
          ])
        );
      }
    } else if (requestUrl.pathname === '/api/games' && request.method === 'POST') {
      postedGames.push(body);
      postCount += 1;
      if (postCount === 1) response.end(JSON.stringify({ id: 'game-64' }));
      else {
        response.statusCode = 409;
        response.end(JSON.stringify({ game: { id: 'game-64' } }));
      }
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const stateRoot = path.join(root, 'state');
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
            listQuestarrRommImportMappingsAction,
            requestQuestarrGameAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');
          writeEnvConfig({
            ENABLE_QUESTARR: 'true',
            ENABLE_ROMM: 'true',
            QUESTARR_URL: 'http://127.0.0.1:${address.port}',
            ROMM_URL: 'http://127.0.0.1:${address.port}',
            ROMM_API_KEY: 'romm-key',
            STATE_ROOT: '${stateRoot}',
            USERNAME: 'stackarr-user',
            PASSWORD: 'stackarr-password'
          });
          const ambiguous = await requestQuestarrGameAction({ title: 'Example Game', fsSlug: 'n64' });
          const platformAmbiguous = await requestQuestarrGameAction({ title: 'Solo Game', fsSlug: 'n64' });
          const added = await requestQuestarrGameAction({
            title: 'Example Game',
            platform: 'Nintendo 64'
          });
          const existing = await requestQuestarrGameAction({
            title: 'Example Game',
            platform: 'Nintendo 64',
            fsSlug: 'n64'
          });
          let conflict = '';
          try {
            await requestQuestarrGameAction({
              title: 'Example Game',
              platform: 'Nintendo 64',
              fsSlug: 'snes'
            });
          } catch (error) {
            conflict = error instanceof Error ? error.message : String(error);
          }
          const mappings = await listQuestarrRommImportMappingsAction();
          const catalog = getMcpToolCatalog({ profile: 'manage', enabledServices: ['questarr', 'romm'] })
            .filter((tool) => tool.name === 'stackarr_request_game')
            .map((tool) => ({ name: tool.name, risk: tool.risk }));
          const missingRommCatalog = getMcpToolCatalog({ profile: 'manage', enabledServices: ['questarr'] })
            .filter((tool) => tool.name === 'stackarr_request_game');
          console.log(
            JSON.stringify({
              ambiguous,
              platformAmbiguous,
              added,
              existing,
              conflict,
              mappings,
              catalog,
              missingRommCatalog
            })
          );
        `
      ],
      { cwd: repoRoot, env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') } }
    );
    const result = JSON.parse(stdout) as Record<string, any>;

    assert.deepEqual(result.ambiguous, {
      status: 'ambiguous',
      title: 'Example Game',
      candidates: [
        { igdbId: 64, title: 'Example Game', platforms: ['Nintendo 64'] },
        { igdbId: 65, title: 'Example Game', platforms: ['PC (Microsoft Windows)'] }
      ]
    });
    assert.deepEqual(result.platformAmbiguous, {
      status: 'ambiguous',
      title: 'Solo Game',
      candidates: [{ igdbId: 66, title: 'Solo Game', platforms: ['Nintendo 64', 'PC (Microsoft Windows)'] }]
    });
    assert.deepEqual(result.added, {
      status: 'wanted',
      alreadyInCollection: false,
      game: { igdbId: 64, questarrGameId: 'game-64', title: 'Example Game', fsSlug: 'n64' }
    });
    assert.deepEqual(result.existing, {
      status: 'wanted',
      alreadyInCollection: true,
      game: { igdbId: 64, questarrGameId: 'game-64', title: 'Example Game', fsSlug: 'n64' }
    });
    assert.match(result.conflict, /already mapped to Questarr game game-64 on RomM platform n64/);
    assert.equal(result.mappings.total, 1);
    assert.deepEqual(result.catalog, [{ name: 'stackarr_request_game', risk: 'write' }]);
    assert.deepEqual(result.missingRommCatalog, []);
    assert.equal(postedGames.length, 3);
    assert.equal(postedGames[0]?.summary, 'The full selected IGDB payload must survive.');
    assert.deepEqual(postedGames[0]?.cover, { url: 'https://images.igdb.com/example.jpg' });
    assert.equal(postedGames[0]?.status, 'wanted');
    assert.equal(postedGames[0]?.platform, 'Nintendo 64');
    assert.doesNotMatch(stdout, /https:\/\/images\.igdb\.com/);

    const state = JSON.parse(await readFile(path.join(stateRoot, 'questarr-romm-import.json'), 'utf8')) as {
      games: Array<Record<string, unknown>>;
    };
    assert.equal(state.games.length, 1);
    assert.equal(state.games[0]?.fsSlug, 'n64');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
