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

test('Transmission browser links open the web client directly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-services-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { writeSettings } = await import('./packages/core/src/settings.ts');
          const { getServices } = await import('./packages/core/src/services.ts');

          writeSettings({
            ui: {
              serviceUrlMode: 'portless',
              serviceUrlScheme: 'https',
              serviceUrlHostSuffix: 'stackarr'
            }
          });

          const transmission = getServices().find((service) => service.name === 'transmission');
          console.log(transmission?.browserUrl ?? '');
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

    assert.equal(stdout.trim(), 'https://transmission.stackarr/transmission/web/');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Cloudflare route normalization accepts download clients', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-services-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { getCloudflareRoutesAction, updateCloudflareRoutesAction } = await import('./packages/core/src/actions/stack.ts');

          updateCloudflareRoutesAction({
            routes: [
              { hostname: 'https://transmission.example.com/web', service: 'transmission' },
              { hostname: 'qbittorrent.example.com', service: 'qbittorrent' },
              { hostname: 'ignored.example.com', service: 'not-a-service' }
            ]
          });

          console.log(JSON.stringify(getCloudflareRoutesAction().routes));
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

    assert.deepEqual(JSON.parse(stdout), [
      { hostname: 'transmission.example.com', service: 'transmission' },
      { hostname: 'qbittorrent.example.com', service: 'qbittorrent' }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
