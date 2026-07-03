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

test('API key auth fails closed for command-style requests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-api-auth-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { requireApiKey } = await import('./apps/frontend/src/lib/api.ts');
          const { PUT: putStackarrConfig } = await import('./apps/frontend/src/app/api/v1/config/stackarr/route.ts');
          const { NextRequest } = await import('./apps/frontend/node_modules/next/server.js');

          const commandUrl = 'http://127.0.0.1:7777/api/v1/command';
          const missingKey = requireApiKey(new NextRequest(commandUrl, { method: 'POST' }));
          const bootstrapResponse = await putStackarrConfig(
            new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ config: { STACKARR_WEB_PORT: '7777' } })
            })
          );
          const bootstrapBody = await bootstrapResponse.json();

          const noHeader = requireApiKey(new NextRequest(commandUrl, { method: 'POST' }));
          const sameOriginBrowser = requireApiKey(
            new NextRequest(commandUrl, {
              method: 'POST',
              headers: {
                origin: 'http://127.0.0.1:7777',
                'sec-fetch-site': 'same-origin'
              }
            })
          );
          const validHeader = requireApiKey(
            new NextRequest(commandUrl, {
              method: 'POST',
              headers: { 'x-api-key': bootstrapBody.apiKey }
            })
          );

          console.log(JSON.stringify({
            missingKey: missingKey?.status,
            bootstrapStatus: bootstrapResponse.status,
            generatedKey: typeof bootstrapBody.apiKey === 'string' && bootstrapBody.apiKey.length >= 32,
            noHeader: noHeader?.status,
            sameOriginBrowser: sameOriginBrowser?.status,
            validHeader: validHeader === null
          }));
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

    const result = JSON.parse(stdout);

    assert.equal(result.missingKey, 503);
    assert.equal(result.bootstrapStatus, 200);
    assert.equal(result.generatedKey, true);
    assert.equal(result.noHeader, 401);
    assert.equal(result.sameOriginBrowser, 401);
    assert.equal(result.validHeader, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
