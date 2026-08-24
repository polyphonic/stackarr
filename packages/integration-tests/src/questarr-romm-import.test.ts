import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('Questarr RomM scheduler uses the supported importer CLI', async () => {
  const scheduler = await readFile(path.join(repoRoot, 'stackarr/scripts/scheduler.sh'), 'utf8');
  const questarrCli = await readFile(path.join(repoRoot, 'stackarr/scripts/questarr.sh'), 'utf8');
  assert.match(scheduler, /questarr romm-import run --yes/);
  assert.match(scheduler, /already_ran "questarr-romm-import"/);
  assert.match(scheduler, /mark_ran "questarr-romm-import"/);
  assert.doesNotMatch(scheduler, /mcp questarr-romm-import/);
  assert.match(questarrCli, /questarr-romm-import run/);
});

test('Questarr RomM importer registers mappings and rejects a symlinked download ancestor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-questarr-romm-import-test-'));
  await mkdir(path.join(root, 'downloads'), { recursive: true });
  await mkdir(path.join(root, 'outside', 'Example.Game'), { recursive: true });
  await mkdir(path.join(root, 'romm', 'roms'), { recursive: true });
  await writeFile(path.join(root, 'outside', 'Example.Game', 'game.z64'), 'payload');
  await symlink(path.join(root, 'outside'), path.join(root, 'downloads', 'linked'));
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (requestUrl.pathname === '/api/platforms' && request.headers.authorization === 'Bearer romm-key') {
      response.end(JSON.stringify([{ id: 1, fs_slug: 'n64', name: 'Nintendo 64' }]));
    } else if (requestUrl.pathname === '/api/auth/login') response.end(JSON.stringify({ token: 'questarr-token' }));
    else if (request.headers.authorization !== 'Bearer questarr-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
    } else if (requestUrl.pathname === '/api/igdb/game/42')
      response.end(JSON.stringify({ id: 42, name: 'Example / Game', platforms: ['Nintendo 64'] }));
    else if (requestUrl.pathname === '/api/games' && request.method === 'GET')
      response.end(
        JSON.stringify([
          {
            id: 'game-auto',
            igdbId: 43,
            title: 'Wanted N64 Game',
            status: 'wanted',
            platforms: [{ name: 'Nintendo 64' }]
          }
        ])
      );
    else if (requestUrl.pathname === '/api/games' && request.method === 'POST')
      response.end(JSON.stringify({ id: 'game-42' }));
    else if (requestUrl.pathname === '/api/games/game-42/downloads') {
      response.end(
        JSON.stringify([
          {
            id: 'tracked-paused',
            gameId: 'game-42',
            downloaderId: 'downloader-1',
            downloadHash: 'hash-paused',
            status: 'paused'
          },
          {
            id: 'tracked-42',
            gameId: 'game-42',
            downloaderId: 'downloader-1',
            downloadHash: 'hash-42',
            status: 'completed'
          }
        ])
      );
    } else if (requestUrl.pathname === '/api/downloaders/downloader-1/downloads/hash-42/details') {
      response.end(
        JSON.stringify({ name: 'Example.Game', downloadDir: path.join(root, 'downloads', 'linked'), files: [] })
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
            listQuestarrRommImportMappingsAction,
            reconcileQuestarrRommImportsAction,
            registerQuestarrRommGameAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');
          writeEnvConfig({
            ENABLE_QUESTARR: 'true',
            ENABLE_ROMM: 'true',
            QUESTARR_URL: 'http://127.0.0.1:${address.port}',
            ROMM_URL: 'http://127.0.0.1:${address.port}',
            ROMM_API_KEY: 'romm-key',
            QUESTARR_ROMM_DOWNLOAD_ROOT: '${path.join(root, 'downloads')}',
            QUESTARR_ROMM_LIBRARY_ROOT: '${path.join(root, 'romm')}',
            STATE_ROOT: '${path.join(root, 'state')}',
            USERNAME: 'stackarr-user',
            PASSWORD: 'stackarr-password'
          });
          const registered = await registerQuestarrRommGameAction({ igdbId: 42, fsSlug: 'n64' });
          const listed = await listQuestarrRommImportMappingsAction();
          const reconcile = await reconcileQuestarrRommImportsAction();
          let disabledError = '';
          try { await reconcileQuestarrRommImportsAction({ dryRun: false }); }
          catch (error) { disabledError = error.message; }
          const catalog = getMcpToolCatalog({ profile: 'manage', enabledServices: ['questarr', 'romm'] })
            .filter((tool) => tool.name.includes('questarr_romm'))
            .map((tool) => ({ name: tool.name, risk: tool.risk }));
          const questarrOnlyCatalog = getMcpToolCatalog({ profile: 'manage', enabledServices: ['questarr'] })
            .filter((tool) => tool.name.includes('questarr_romm'));
          console.log(JSON.stringify({ registered, listed, reconcile, disabledError, catalog, questarrOnlyCatalog }));
        `
      ],
      { cwd: repoRoot, env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') } }
    );
    const result = JSON.parse(stdout) as Record<string, any>;
    assert.equal(result.registered.game.title, 'Example / Game');
    assert.equal(result.listed.total, 1);
    assert.equal(result.listed.mappings[0].fsSlug, 'n64');
    assert.equal(result.reconcile.dryRun, true);
    assert.match(result.disabledError, /secure Questarr to RomM import is disabled/i);
    assert.equal(result.reconcile.results.length, 2);
    assert.deepEqual(result.reconcile.results[0], {
      gameId: 'game-auto',
      title: 'Wanted N64 Game',
      fsSlug: 'n64',
      status: 'would-register'
    });
    assert.equal(result.reconcile.results[1].status, 'rejected');
    assert.match(result.reconcile.results[1].reason, /outside the shared \/downloads root/);
    assert.deepEqual(result.catalog, [
      { name: 'stackarr_register_questarr_romm_game', risk: 'write' },
      { name: 'stackarr_list_questarr_romm_import_mappings', risk: 'read' },
      { name: 'stackarr_reconcile_questarr_romm_imports', risk: 'write' }
    ]);
    assert.deepEqual(
      result.questarrOnlyCatalog.map((tool: { name: string }) => tool.name),
      ['stackarr_list_questarr_romm_import_mappings']
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});

test('Questarr RomM importer gates placement on ClamAV and leaves infected payloads out of RomM', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-questarr-romm-clamav-test-'));
  const source = path.join(root, 'downloads', 'Example.Game');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'game.z64'), 'safe test payload');

  let scanReply = '/downloads/Example.Game: OK\0';
  const scanCommands: string[] = [];
  const clamav = createNetServer((socket) => {
    let command = '';
    socket.on('data', (chunk) => {
      command += chunk.toString('utf8');
      if (!command.includes('\0')) return;
      scanCommands.push(command);
      socket.end(scanReply);
    });
  });
  await new Promise<void>((resolve) => clamav.listen(0, '127.0.0.1', resolve));

  const api = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (requestUrl.pathname === '/api/platforms' && request.headers.authorization === 'Bearer romm-key')
      response.end(JSON.stringify([{ id: 1, fs_slug: 'n64', name: 'Nintendo 64' }]));
    else if (requestUrl.pathname === '/api/auth/login') response.end(JSON.stringify({ token: 'questarr-token' }));
    else if (requestUrl.pathname === '/api/login') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'scan auth intentionally unavailable in this focused test' }));
    } else if (request.headers.authorization !== 'Bearer questarr-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
    } else if (requestUrl.pathname === '/api/igdb/game/42')
      response.end(JSON.stringify({ id: 42, name: 'Example Game', platforms: ['Nintendo 64'] }));
    else if (requestUrl.pathname === '/api/games' && request.method === 'GET') response.end('[]');
    else if (requestUrl.pathname === '/api/games' && request.method === 'POST')
      response.end(JSON.stringify({ id: 'game-42' }));
    else if (requestUrl.pathname === '/api/games/game-42/downloads')
      response.end(
        JSON.stringify([
          {
            id: 'tracked-42',
            downloaderId: 'downloader-1',
            downloadHash: 'hash-42',
            status: 'completed'
          }
        ])
      );
    else if (requestUrl.pathname === '/api/downloaders/downloader-1/downloads/hash-42/details')
      response.end(
        JSON.stringify({
          name: 'Example.Game',
          downloadDir: path.join(root, 'downloads'),
          files: [{ name: 'Example.Game/game.z64', wanted: true }]
        })
      );
    else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    }
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));

  const apiAddress = api.address();
  const clamavAddress = clamav.address();
  assert.ok(apiAddress && typeof apiAddress === 'object');
  assert.ok(clamavAddress && typeof clamavAddress === 'object');

  const runCase = async (caseName: string) => {
    const stateRoot = path.join(root, `state-${caseName}`);
    const libraryRoot = path.join(root, `romm-${caseName}`);
    await mkdir(path.join(libraryRoot, 'roms'), { recursive: true });
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const {
            listQuestarrRommImportMappingsAction,
            reconcileQuestarrRommImportsAction,
            registerQuestarrRommGameAction,
            writeEnvConfig
          } =
            await import('./packages/core/src/index.ts');
          writeEnvConfig({
            ENABLE_QUESTARR: 'true',
            ENABLE_ROMM: 'true',
            QUESTARR_URL: 'http://127.0.0.1:${apiAddress.port}',
            ROMM_URL: 'http://127.0.0.1:${apiAddress.port}',
            ROMM_API_KEY: 'romm-key',
            QUESTARR_ROMM_DOWNLOAD_ROOT: '${path.join(root, 'downloads')}',
            QUESTARR_ROMM_LIBRARY_ROOT: '${libraryRoot}',
            QUESTARR_ROMM_IMPORT_ENABLED: 'true',
            QUESTARR_ROMM_CLAMAV_ENABLED: 'true',
            QUESTARR_ROMM_CLAMAV_HOST: '127.0.0.1',
            QUESTARR_ROMM_CLAMAV_PORT: '${clamavAddress.port}',
            STATE_ROOT: '${stateRoot}',
            USERNAME: 'stackarr-user',
            PASSWORD: 'stackarr-password'
          });
          await registerQuestarrRommGameAction({ igdbId: 42, fsSlug: 'n64' });
          const result = await reconcileQuestarrRommImportsAction({ dryRun: false, mode: 'copy' });
          console.log(JSON.stringify({ result, mappings: await listQuestarrRommImportMappingsAction() }));
        `
      ],
      { cwd: repoRoot, env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, `${caseName}.db`) } }
    );
    return { output: JSON.parse(stdout) as Record<string, any>, libraryRoot };
  };

  try {
    const clean = await runCase('clean');
    assert.equal(clean.output.result.results[0].status, 'imported');
    assert.equal(clean.output.result.rescanNeeded, true);
    assert.deepEqual(clean.output.mappings.pendingScanSlugs, ['n64']);
    await access(path.join(clean.libraryRoot, 'roms', 'n64', 'Example Game', 'game.z64'));
    assert.match(scanCommands[0] || '', /^zCONTSCAN /);

    scanReply = '/downloads/Example.Game/game.z64: Test.Signature FOUND\0';
    const infected = await runCase('infected');
    assert.equal(infected.output.result.results[0].status, 'rejected');
    assert.match(infected.output.result.results[0].reason, /ClamAV rejected/);
    assert.deepEqual(infected.output.mappings.pendingScanSlugs, []);
    await assert.rejects(access(path.join(infected.libraryRoot, 'roms', 'n64', 'Example Game', 'game.z64')));
  } finally {
    await new Promise<void>((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => clamav.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
