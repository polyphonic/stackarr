import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { composeServicesAffectedByEnvironment } from '../../core/src/composeRuntime';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('Tdarr actions authenticate, bound output, omit node credentials, and pause only an existing node', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-tdarr-test-'));
  const calls: Array<{ path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : undefined;
    calls.push({ path: req.url ?? '', body: data });
    res.setHeader('content-type', 'application/json');
    if (req.headers['x-api-key'] !== 'tapi_fixture_secret') {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (req.url === '/api/v2/status')
      res.end(JSON.stringify({ status: 'good', version: 'fixture', secret: 'do-not-return' }));
    else if (req.url === '/api/v2/get-nodes')
      res.end(
        JSON.stringify({
          node1: { nodeName: 'Worker', nodePaused: true, workers: {}, config: { apiKey: 'do-not-return' } }
        })
      );
    else if (req.url === '/api/v2/cruddb')
      res.end(
        JSON.stringify([
          { _id: 'lib1', name: 'Movies', folder: '/media/Movies', cache: '/temp', processTranscodes: false },
          { _id: 'lib2', name: 'TV' }
        ])
      );
    else if (req.url === '/api/v2/update-node') {
      res.setHeader('content-type', 'text/plain');
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      const {writeEnvConfig,readEnv,redactEnv}=await import('./packages/core/src/env.ts');
      const {getServices}=await import('./packages/core/src/services.ts');
      const {getTdarrStatusAction,listTdarrLibrariesAction,listTdarrNodesAction,pauseTdarrNodeAction}=await import('./packages/core/src/actions/tdarr.ts');
      writeEnvConfig({ENABLE_TDARR:'true',TDARR_API_KEY:'tapi_fixture_secret',TDARR_API_URL:'http://127.0.0.1:${address.port}',STACKARR_DATABASE_MODE:'postgres'});
      // Database mode changes do not change Tdarr's native backend.
      assert.equal(getServices().find(s=>s.name==='tdarr').mode,'docker');
      const status=await getTdarrStatusAction(); const libraries=await listTdarrLibrariesAction({limit:1}); const nodes=await listTdarrNodesAction();
      await assert.rejects(listTdarrLibrariesAction({limit:101}));
      await assert.rejects(pauseTdarrNodeAction({nodeId:'missing'}));
      const paused=await pauseTdarrNodeAction({nodeId:'node1'});
      assert.notEqual(redactEnv(readEnv()).TDARR_API_KEY,'tapi_fixture_secret');
      writeEnvConfig({ENABLE_TDARR:'false'}); await assert.rejects(getTdarrStatusAction(),/disabled/);
      console.log(JSON.stringify({status,libraries,nodes,paused}));
    `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          STACKARR_DATABASE_URL: '',
          STACKARR_LOG_DATABASE_URL: '',
          STACKARR_RUNTIME: 'test'
        }
      }
    );
    assert.doesNotMatch(stdout, /do-not-return|fixture_secret/);
    const result = JSON.parse(stdout);
    assert.equal(result.libraries.libraries.length, 1);
    assert.equal(result.libraries.total, 2);
    assert.equal(result.nodes.nodes[0].paused, true);
    assert.deepEqual(calls.find((c) => c.path === '/api/v2/update-node')?.body, {
      data: { nodeID: 'node1', nodeUpdates: { nodePaused: true } }
    });
    assert.deepEqual(calls.find((c) => c.path === '/api/v2/cruddb')?.body, {
      data: { collection: 'LibrarySettingsJSONDB', mode: 'getAll' }
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('Tdarr lifecycle is independent of the shared PostgreSQL backend and owns persistent app-data mounts', async () => {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ENABLE_TDARR']), ['tdarr']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['TDARR_API_KEY']), ['tdarr']);
  const block = compose.split('  tdarr:')[1].split('  maintainerr:')[0];
  assert.doesNotMatch(block, /POSTGRES|database:|depends_on/);
  assert.match(block, /tdarr\/server:\/app\/server/);
  assert.match(block, /startPaused: \$\{TDARR_START_PAUSED:-true\}/);
});
