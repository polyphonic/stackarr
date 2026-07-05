import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('Portless browser links use unified dashboard routes by default', async () => {
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
          const { directPortlessBrowserUrl, getServices } = await import('./packages/core/src/services.ts');

          writeSettings({
            ui: {
              serviceUrlMode: 'portless',
              serviceUrlScheme: 'https',
              serviceUrlHostSuffix: 'stackarr:1355'
            }
          });

          const transmission = getServices().find((service) => service.name === 'transmission');
          console.log(JSON.stringify({
            browserUrl: transmission?.browserUrl ?? '',
            directUrl: directPortlessBrowserUrl('transmission', undefined, '/transmission/web/')
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

    assert.deepEqual(JSON.parse(stdout), {
      browserUrl: 'https://app.stackarr/transmission',
      directUrl: 'https://transmission.stackarr/transmission/web/'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Portless browser links can use direct service aliases', async () => {
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
              serviceUrlHostSuffix: 'stackarr:1355',
              unifyServiceUrls: false
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

test('Portless script registers configured tld aliases before host sync', async () => {
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/portless.sh'), 'utf8');

  assert.match(script, /ensure_route_file_alias "\$name" "\$port"/);
  assert.match(script, /STACKARR_PORTLESS_TLD="\$tld"/);
  assert.match(script, /PORTLESS_TLD="\$tld" portless hosts sync/);
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
              { hostname: 'cleanup.example.com', service: 'maintainerr' },
              { hostname: 'monitoring.example.com', service: 'tracearr' },
              { hostname: 'games.example.com', service: 'romm', access: true },
              { hostname: 'photos.example.com', service: 'immich' },
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
      { hostname: 'transmission.example.com', service: 'transmission', access: true },
      { hostname: 'qbittorrent.example.com', service: 'qbittorrent', access: true },
      { hostname: 'cleanup.example.com', service: 'maintainerr', access: true },
      { hostname: 'monitoring.example.com', service: 'tracearr', access: true },
      { hostname: 'games.example.com', service: 'romm', access: true },
      { hostname: 'photos.example.com', service: 'immich', access: false }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Cloudflare route installer protects Access routes before publishing hostnames', async () => {
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/cloudflare.sh'), 'utf8');
  const accessIndex = script.indexOf('ensure_cloudflare_access_application "$effective_api_token"');
  const publishIndex = script.indexOf('ensure_cloudflare_public_hostname "$effective_api_token"');

  assert.match(script, /CLOUDFLARE_ACCESS_ALLOWED_EMAILS/);
  assert.match(script, /ensure_cloudflare_access_otp_identity_provider/);
  assert.match(script, /DEFAULT_ACCESS_POLICY_NAME=.*Email Allowlist/);
  assert.match(script, /\/accounts\/\$account_id\/access\/identity_providers/);
  assert.match(script, /\/accounts\/\$account_id\/access\/apps/);
  assert.match(script, /\/accounts\/\$account_id\/access\/policies/);
  assert.match(script, /body\["policies"\] = \[\{"id": reusable_policy_id\}\]/);
  assert.match(script, /cloudflare_api_request "PUT" "\/accounts\/\$account_id\/access\/apps\/\$app_id"/);
  assert.match(script, /cloudflare_api_request "PUT" "\/accounts\/\$account_id\/access\/policies\/\$policy_id"/);
  assert.ok(accessIndex > -1, 'Access app creation should be wired into install');
  assert.ok(publishIndex > -1, 'Public hostname creation should still be wired into install');
  assert.ok(accessIndex < publishIndex, 'Access app should be created before the public hostname is published');
});
