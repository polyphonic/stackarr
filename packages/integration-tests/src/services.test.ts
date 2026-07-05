import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('Portless browser links use direct service aliases by default', async () => {
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
              serviceUrlHostSuffix: 'stack:1355'
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
      browserUrl: 'https://transmission.stack',
      directUrl: 'https://transmission.stack/transmission/web/'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Portless browser links ignore the legacy unify flag', async () => {
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
              serviceUrlHostSuffix: 'stack:1355',
              unifyServiceUrls: true
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

    assert.equal(stdout.trim(), 'https://transmission.stack');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Disabled optional services do not publish Portless browser URLs', async () => {
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
              serviceUrlHostSuffix: ''
            }
          });

          process.env.ENABLE_MAINTAINERR = 'false';
          const maintainerr = getServices().find((service) => service.name === 'maintainerr');
          console.log(JSON.stringify({
            status: maintainerr?.status,
            browserUrl: maintainerr?.browserUrl ?? null
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
      status: 'disabled',
      browserUrl: null
    });
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

test('Portless apply prunes legacy suffix and disabled Stackarr aliases', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-services-test-'));
  const binDir = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const routesDir = path.join(homeDir, '.portless');
  const routesFile = path.join(routesDir, 'routes.json');
  const fakePortless = path.join(binDir, 'portless');

  try {
    await mkdir(binDir, { recursive: true });
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      routesFile,
      JSON.stringify(
        [
          { hostname: 'app.stackarr', port: 7777, pid: 0 },
          { hostname: 'maintainerr.stack', port: 6246, pid: 0 },
          { hostname: 'custom.stackarr', port: 9999, pid: 0 }
        ],
        null,
        2
      ) + '\n'
    );
    await writeFile(
      fakePortless,
      [
        '#!/bin/sh',
        'if [ "$1" = "proxy" ] && [ "$2" = "start" ]; then exit 0; fi',
        'if [ "$1" = "alias" ]; then exit 0; fi',
        'if [ "$1" = "hosts" ] && [ "$2" = "sync" ]; then exit 0; fi',
        'if [ "$1" = "list" ]; then exit 0; fi',
        'exit 0',
        ''
      ].join('\n')
    );
    await chmod(fakePortless, 0o755);

    await execFile('bash', ['stackarr/scripts/portless.sh', 'apply'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: homeDir,
        APP_ROOT: path.join(root, 'app'),
        CONFIG_ROOT: path.join(root, 'app/config'),
        STATE_ROOT: path.join(root, 'app/state'),
        LOG_ROOT: path.join(root, 'app/logs'),
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        STACKARR_SERVICE_URL_MODE: 'portless',
        STACKARR_SERVICE_URL_SCHEME: 'https',
        STACKARR_SERVICE_URL_HOST_SUFFIX: 'stack',
        STACKARR_WEB_ENABLED: 'true',
        ENABLE_MAINTAINERR: 'false',
        ENABLE_TRACEARR: 'false',
        ENABLE_SEERR: 'false',
        ENABLE_TIDARR: 'false'
      }
    });

    const routes = JSON.parse(await readFile(routesFile, 'utf8'));
    const hostnames = routes.map((route: { hostname: string }) => route.hostname).sort();

    assert.ok(hostnames.includes('app.stack'));
    assert.ok(hostnames.includes('custom.stackarr'));
    assert.ok(!hostnames.includes('app.stackarr'));
    assert.ok(!hostnames.includes('maintainerr.stack'));
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
