import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('API explorer discovers the live Pulsarr and Tracearr contracts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-api-explorer-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const requested = [];
          globalThis.fetch = async (input) => {
            const url = String(input);
            requested.push(url);
            const supported = url.endsWith('/api/docs/openapi.json') || url.endsWith('/api/v1/public/docs');
            return supported
              ? new Response(JSON.stringify({
                  openapi: '3.0.0',
                  info: { title: 'Live API', version: '1.0.0' },
                  paths: { '/stats': { get: { summary: 'Read statistics', tags: ['Stats'] } } }
                }), { headers: { 'content-type': 'application/json' } })
              : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
          };

          const { discoverInstalledApiContractsAction } = await import('./packages/core/src/actions/apiExplorer.ts');
          const { readEnv, writeEnvConfig } = await import('./packages/core/src/env.ts');
          writeEnvConfig({
            ...readEnv(),
            PLEX_INSTALL_MODE: 'docker',
            ENABLE_MOVIES: 'true',
            ENABLE_PULSARR: 'true',
            ENABLE_TRACEARR: 'true',
            PULSARR_API_KEY: 'pulsarr-test-key',
            TRACEARR_API_KEY: 'tracearr-test-key'
          });
          const result = await discoverInstalledApiContractsAction({ force: true });
          console.log(JSON.stringify({
            services: result.sources.map((source) => source.service),
            paths: result.sources.map((source) => source.contractPath),
            requested
          }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_MODE: 'sqlite',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          PLEX_INSTALL_MODE: 'docker',
          ENABLE_MOVIES: 'true',
          ENABLE_PULSARR: 'true',
          ENABLE_TRACEARR: 'true',
          PULSARR_API_KEY: 'pulsarr-test-key',
          TRACEARR_API_KEY: 'tracearr-test-key'
        }
      }
    );

    const result = JSON.parse(stdout) as {
      services: string[];
      paths: string[];
      requested: string[];
    };
    assert.ok(result.services.includes('pulsarr'), JSON.stringify(result));
    assert.ok(result.services.includes('tracearr'), JSON.stringify(result));
    assert.ok(result.paths.includes('/api/docs/openapi.json'));
    assert.ok(result.paths.includes('/api/v1/public/docs'));
    assert.ok(result.requested.some((url) => url.endsWith('/api/docs/openapi.json')));
    assert.ok(result.requested.some((url) => url.endsWith('/api/v1/public/docs')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
