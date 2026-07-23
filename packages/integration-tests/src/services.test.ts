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

test('new installs default to Portless links without duplicating global link settings on each app', async () => {
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
          const { readSettings } = await import('./packages/core/src/settings.ts');
          const { getServiceConfigAction } = await import('./packages/core/src/serviceCatalog.ts');
          const { getServices } = await import('./packages/core/src/services.ts');
          const transmission = getServices().find((service) => service.name === 'transmission');
          const immich = getServiceConfigAction({ service: 'immich' });
          console.log(JSON.stringify({
            mode: readSettings().ui.serviceUrlMode,
            browserUrl: transmission?.browserUrl,
            groups: immich.groups.map((group) => group.title)
          }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          ENABLE_IMMICH: 'true'
        }
      }
    );

    assert.deepEqual(JSON.parse(stdout), {
      mode: 'portless',
      browserUrl: 'https://transmission.stack',
      groups: ['Photos (Immich)', 'Immich Database']
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
          const plex = getServices().find((service) => service.name === 'plex');
          console.log(JSON.stringify({
            browserUrl: transmission?.browserUrl ?? '',
            directUrl: directPortlessBrowserUrl('transmission', undefined, '/transmission/web/'),
            plexUrl: plex?.browserUrl ?? ''
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
      directUrl: 'https://transmission.stack/transmission/web/',
      plexUrl: 'https://plex.stack/web/index.html'
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

test('Disabled media categories remove their dependent services from the configured stack', async () => {
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
          const { writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getServices } = await import('./packages/core/src/services.ts');
          writeEnvConfig({
            ENABLE_MOVIES: 'false',
            ENABLE_TV_SHOWS: 'false',
            ENABLE_LIDARR: 'false'
          });
          const services = getServices();
          const modes = Object.fromEntries(
            ['prowlarr', 'radarr', 'sonarr', 'lidarr', 'streamrip'].map((name) => [
              name,
              services.find((service) => service.name === name)?.mode
            ])
          );
          console.log(JSON.stringify(modes));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          ENABLE_MOVIES: 'false',
          ENABLE_TV_SHOWS: 'false',
          ENABLE_LIDARR: 'false'
        }
      }
    );

    assert.deepEqual(JSON.parse(stdout), {
      prowlarr: 'disabled',
      radarr: 'disabled',
      sonarr: 'disabled',
      lidarr: 'disabled',
      streamrip: 'disabled'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('App catalog explains dependencies for unavailable media companions', async () => {
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
          const { writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getServices } = await import('./packages/core/src/services.ts');
          writeEnvConfig({
            PLEX_INSTALL_MODE: 'disabled',
            JELLYFIN_INSTALL_MODE: 'disabled',
            ENABLE_MOVIES: 'false',
            ENABLE_TV_SHOWS: 'false',
            ENABLE_IMMICH: 'true',
            ENABLE_PULSARR: 'true',
            ENABLE_SEERR: 'true'
          });
          const services = getServices();
          console.log(JSON.stringify(Object.fromEntries(
            ['immich', 'pulsarr', 'seerr', 'bazarr'].map((name) => {
              const service = services.find((item) => item.name === name);
              return [name, { mode: service?.mode, experience: service?.experience, requirement: service?.requirement }];
            })
          )));
        `
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') }
      }
    );

    const services = JSON.parse(stdout);
    assert.equal(services.immich.mode, 'docker');
    assert.equal(services.immich.experience, 'app');
    assert.equal(services.pulsarr.mode, 'disabled');
    assert.equal(services.pulsarr.requirement.satisfied, false);
    assert.equal(services.seerr.mode, 'disabled');
    assert.equal(services.bazarr.requirement.satisfied, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Service credentials fall back to authoritative local Arr and Plex configuration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-services-test-'));
  const configRoot = path.join(root, 'config');
  const preferencesPath = path.join(root, 'Plex Preferences.xml');

  try {
    await mkdir(path.join(configRoot, 'sonarr'), { recursive: true });
    await writeFile(
      path.join(configRoot, 'sonarr', 'config.xml'),
      '<Config><ApiKey>fixture-sonarr-key</ApiKey></Config>'
    );
    await writeFile(
      preferencesPath,
      '<plist><dict><key>PlexOnlineToken</key><string>fixture-plex&amp;token</string></dict></plist>'
    );

    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { serviceApiKey } = await import('./packages/core/src/clients/serviceConfig.ts');
          writeEnvConfig({
            CONFIG_ROOT: ${JSON.stringify(configRoot)},
            PLEX_PREFS_PATH: ${JSON.stringify(preferencesPath)},
            SONARR_API_KEY: '',
            PLEX_TOKEN: ''
          });
          const discovered = { sonarr: serviceApiKey('sonarr'), plex: serviceApiKey('plex') };
          writeEnvConfig({ SONARR_API_KEY: 'explicit-override' });
          console.log(JSON.stringify({ discovered, override: serviceApiKey('sonarr') }));
        `
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') }
      }
    );

    assert.deepEqual(JSON.parse(stdout), {
      discovered: { sonarr: 'fixture-sonarr-key', plex: 'fixture-plex&token' },
      override: 'explicit-override'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Docker runtime service URLs use reachable hosts and skip non-network helpers', async () => {
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
          const { writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getServiceStatusAction } = await import('./packages/core/src/actions/services.ts');
          const { maybeServiceBaseUrl, serviceBaseUrl } = await import('./packages/core/src/clients/serviceConfig.ts');

          writeEnvConfig({ ENABLE_4K_SERVARR: 'true' });

          console.log(JSON.stringify({
            radarr4k: serviceBaseUrl('radarr4k'),
            bazarr: serviceBaseUrl('bazarr'),
            plex: serviceBaseUrl('plex'),
            recyclarr: maybeServiceBaseUrl('recyclarr') ?? null,
            recyclarrStatus: await getServiceStatusAction({ service: 'recyclarr' })
          }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_RUNTIME: 'docker',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.radarr4k, 'http://radarr4k:7878');
    assert.equal(result.bazarr, 'http://bazarr:6767');
    assert.equal(result.plex, 'http://plex:32400');
    assert.equal(result.recyclarr, null);
    assert.equal(result.recyclarrStatus.unsupported, true);
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

test('Portless apply restarts a mismatched proxy and keeps the configured suffix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-services-test-'));
  const binDir = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const routesDir = path.join(homeDir, '.portless');
  const routesFile = path.join(routesDir, 'routes.json');
  const fakePortless = path.join(binDir, 'portless');
  const callsFile = path.join(root, 'portless-calls.log');

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
    await writeFile(path.join(routesDir, 'proxy.tld'), 'stackarr\n');
    await writeFile(
      fakePortless,
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$PORTLESS_CALLS_FILE"',
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
        PORTLESS_CALLS_FILE: callsFile,
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
    const calls = await readFile(callsFile, 'utf8');

    assert.ok(hostnames.includes('app.stack'));
    assert.ok(hostnames.includes('custom.stackarr'));
    assert.ok(!hostnames.includes('app.stackarr'));
    assert.ok(!hostnames.includes('maintainerr.stack'));
    assert.match(calls, /^proxy stop$/m);
    assert.match(calls, /^proxy start --tld stack$/m);
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

test('Cloudflare route apply uses route-only command outside host-only runner gate', async () => {
  const commands = await readFile(path.join(repoRoot, 'packages/core/src/commands.ts'), 'utf8');
  const settingsEditor = await readFile(path.join(repoRoot, 'apps/frontend/src/components/SettingsEditor.tsx'), 'utf8');
  const runner = await readFile(path.join(repoRoot, 'apps/frontend/src/lib/runner.ts'), 'utf8');
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/cloudflare.sh'), 'utf8');

  assert.match(commands, /CloudflareApplyRoutes/);
  assert.match(commands, /args: \['cloudflare', 'routes', 'apply'\]/);
  assert.match(settingsEditor, /name: 'CloudflareApplyRoutes'/);
  assert.match(script, /apply_cloudflare_routes\(\)/);
  assert.doesNotMatch(runner, /'CloudflareApplyRoutes'/);
});
