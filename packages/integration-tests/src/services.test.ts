import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { changedEnvironmentKeys, composeServicesAffectedByEnvironment } from '../../core/src/composeRuntime.ts';

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

test('Cloudflare email allowlist action appends one address and queues publishing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cloudflare-access-test-'));

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
          const { addCloudflareAccessEmailAction } = await import('./packages/core/src/actions/stack.ts');

          writeEnvConfig({
            CLOUDFLARE_ACCESS_ENABLED: 'true',
            CLOUDFLARE_ACCESS_ALLOWED_EMAILS: 'member@example.com',
            CLOUDFLARE_TUNNEL_ROUTES: JSON.stringify([
              { hostname: 'books.example.com', service: 'bookorbit', access: true }
            ])
          });

          const queued = [];
          const queueApply = (input) => {
            queued.push(input);
            return {
              command: input.command,
              label: 'Apply Cloudflare routes',
              taskId: 'cloudflare-task',
              status: 'running'
            };
          };
          const result = addCloudflareAccessEmailAction({ email: 'New.Member@Example.com' }, queueApply);
          const duplicate = addCloudflareAccessEmailAction({ email: 'new.member@example.com' }, queueApply);

          console.log(JSON.stringify({ result, duplicate, queued }));
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
    const payload = JSON.parse(stdout);

    assert.equal(payload.result.accepted, true);
    assert.equal(payload.result.added, true);
    assert.deepEqual(payload.result.access.allowedEmails, ['member@example.com', 'new.member@example.com']);
    assert.equal(payload.result.publish.taskId, 'cloudflare-task');
    assert.equal(payload.duplicate.added, false);
    assert.deepEqual(payload.queued, [{ command: 'CloudflareApplyRoutes' }, { command: 'CloudflareApplyRoutes' }]);
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

test('credential apply waits for its task and reports a terminal result', async () => {
  const settingsEditor = await readFile(path.join(repoRoot, 'apps/frontend/src/components/SettingsEditor.tsx'), 'utf8');

  assert.match(settingsEditor, /const applyTask = \(await applyResponse\.json\(\)/);
  assert.match(settingsEditor, /await waitForTask\(applyTask\.id\)/);
  assert.match(settingsEditor, /task\?\.status === 'completed'/);
  assert.match(settingsEditor, /task\?\.status === 'failed' \|\| task\?\.status === 'blocked'/);
  assert.doesNotMatch(settingsEditor, /setSecurityState\(applyResponse\.ok \? 'queued'/);
});

test('host MCP commands use the authoritative running Stackarr controller', async () => {
  const bin = await readFile(path.join(repoRoot, 'stackarr/bin/stackarr'), 'utf8');

  assert.match(bin, /load_env <\/dev\/null/);
  assert.match(bin, /ensure_docker_runtime <\/dev\/null/);
  assert.match(bin, /stackarr_compose ps --services --status running <\/dev\/null/);
  assert.match(bin, /while IFS= read -r service/);
  assert.match(bin, /\[\[ "\$service" == "app" \]\] && app_is_running=true/);
  assert.doesNotMatch(bin, /grep -Fxq app/);
  assert.match(bin, /stackarr_compose exec -T app node packages\/mcp\/dist\/index\.js/);
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

test('Cloudflare settings distinguish saved config from published routes', async () => {
  const settingsEditor = await readFile(path.join(repoRoot, 'apps/frontend/src/components/SettingsEditor.tsx'), 'utf8');
  const settingsStyles = await readFile(
    path.join(repoRoot, 'apps/frontend/src/components/SettingsEditor.module.css'),
    'utf8'
  );
  const connectSection = settingsEditor.slice(
    settingsEditor.indexOf("{section === 'connect'"),
    settingsEditor.indexOf("{section === 'metadata'")
  );

  assert.match(connectSection, /styles\.connectSection/g);
  assert.match(connectSection, /Save stores changes in Stackarr/);
  assert.match(connectSection, /Save & apply routes/);
  assert.match(settingsStyles, /\.connectSection \+ \.connectSection[\s\S]*border-top/);
});

test('RomM library path changes queue storage mount reconciliation', async () => {
  const settingsEditor = await readFile(path.join(repoRoot, 'apps/frontend/src/components/SettingsEditor.tsx'), 'utf8');

  assert.match(
    settingsEditor,
    /const storageEnvKeys = \[[\s\S]*'GAMES_ROOT',[\s\S]*'ROMM_LIBRARY_ROOT',[\s\S]*'ROMM_STEAM_MAC_LIBRARY_ROOT',[\s\S]*'ROMM_STEAM_WINDOWS_LIBRARY_ROOT',[\s\S]*'ROMM_STEAM_LINUX_LIBRARY_ROOT'[\s\S]*\] as const;/
  );
  assert.match(settingsEditor, /body: JSON\.stringify\(\{ name: 'StackStart', confirmed: true \}\)/);
});

test('RomM Steam libraries are opt-in, independently mapped by desktop OS, and cleared when disabled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-romm-steam-test-'));
  const directory = await readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.tsx'), 'utf8');
  const pathPicker = await readFile(path.join(repoRoot, 'apps/frontend/src/components/PathPicker.tsx'), 'utf8');

  assert.match(directory, /field\.enabledWhen \? conditionMatches\(field\.enabledWhen, draft\) : true/);
  assert.match(directory, /title=\{field\.description\}/);
  assert.match(pathPicker, /<input[\s\S]*disabled=\{disabled\}/);

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { readEnv, writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getServiceConfigAction, updateServiceConfigAction } = await import('./packages/core/src/serviceCatalog.ts');

          writeEnvConfig({
            ROMM_STEAM_LIBRARY_ENABLED: 'true',
            ROMM_STEAM_MAC_LIBRARY_ROOT: '/games/steam-mac',
            ROMM_STEAM_WINDOWS_LIBRARY_ROOT: '/games/steam-windows',
            ROMM_STEAM_LINUX_LIBRARY_ROOT: '/games/steam-linux'
          });
          const config = getServiceConfigAction({ service: 'romm' });
          const fields = config.groups.flatMap((group) => group.fields);
          const toggle = fields.find((field) => field.id === 'rommSteamLibraryEnabled');
          const roots = ['rommSteamMacLibraryRoot', 'rommSteamWindowsLibraryRoot', 'rommSteamLinuxLibraryRoot']
            .map((id) => fields.find((field) => field.id === id));
          const result = updateServiceConfigAction({
            service: 'romm',
            values: { rommSteamLibraryEnabled: false }
          });
          const saved = readEnv();
          console.log(JSON.stringify({
            accepted: result.accepted,
            toggle: { value: toggle?.value, infoHover: toggle?.infoHover },
            roots: roots.map((field) => ({ id: field?.id, enabledWhen: field?.enabledWhen })),
            saved: {
              enabled: saved.ROMM_STEAM_LIBRARY_ENABLED,
              mac: saved.ROMM_STEAM_MAC_LIBRARY_ROOT,
              windows: saved.ROMM_STEAM_WINDOWS_LIBRARY_ROOT,
              linux: saved.ROMM_STEAM_LINUX_LIBRARY_ROOT
            }
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
      accepted: true,
      toggle: { value: 'true', infoHover: true },
      roots: [
        { id: 'rommSteamMacLibraryRoot', enabledWhen: { fieldId: 'rommSteamLibraryEnabled', value: true } },
        { id: 'rommSteamWindowsLibraryRoot', enabledWhen: { fieldId: 'rommSteamLibraryEnabled', value: true } },
        { id: 'rommSteamLinuxLibraryRoot', enabledWhen: { fieldId: 'rommSteamLibraryEnabled', value: true } }
      ],
      saved: { enabled: 'false', mac: '', windows: '', linux: '' }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dashboard settings recreate only Compose services affected by changed environment values', async () => {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  const commands = await readFile(path.join(repoRoot, 'packages/core/src/commands.ts'), 'utf8');
  const route = await readFile(
    path.join(repoRoot, 'apps/frontend/src/app/api/v1/services/config/[service]/route.ts'),
    'utf8'
  );
  const directory = await readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.tsx'), 'utf8');
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/service-apply.sh'), 'utf8');

  for (const key of [
    'ROMM_IGDB_CLIENT_ID',
    'ROMM_IGDB_CLIENT_SECRET',
    'ROMM_MOBYGAMES_API_KEY',
    'ROMM_SCREENSCRAPER_USER',
    'ROMM_SCREENSCRAPER_PASSWORD',
    'ROMM_RETROACHIEVEMENTS_API_KEY',
    'ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS',
    'ROMM_STEAMGRIDDB_API_KEY',
    'ROMM_HASHEOUS_API_ENABLED',
    'ROMM_PLAYMATCH_API_ENABLED',
    'ROMM_LAUNCHBOX_API_ENABLED',
    'ROMM_FLASHPOINT_API_ENABLED',
    'ROMM_HLTB_API_ENABLED',
    'ROMM_TGDB_API_ENABLED',
    'ROMM_STEAM_LIBRARY_ENABLED',
    'ROMM_STEAM_MAC_LIBRARY_ROOT',
    'ROMM_STEAM_WINDOWS_LIBRARY_ROOT',
    'ROMM_STEAM_LINUX_LIBRARY_ROOT',
    'ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE',
    'ROMM_RESCAN_ON_FILESYSTEM_CHANGE_DELAY',
    'ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA',
    'ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON'
  ]) {
    assert.match(compose, new RegExp(`${key}`));
  }

  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ROMM_IGDB_CLIENT_SECRET']), ['questarr', 'romm']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['QUESTARR_IGDB_CLIENT_SECRET']), ['questarr']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['TRANSMISSION_PASSWORD']), ['transmission']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['RADARR_POSTGRES_PASSWORD']), ['radarr']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['IMMICH_VERSION']), ['immich', 'immich-ml']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ROMM_STEAM_LIBRARY_ENABLED']), ['romm']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ENABLE_ROMM']), ['romm']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ENABLE_QUESTARR']), ['questarr']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ENABLE_YOUTARR']), ['youtarr', 'youtarr-db']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['YOUTARR_DB_PASSWORD']), ['youtarr', 'youtarr-db']);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['PREFERRED_TORRENT_CLIENT']), [
    'qbittorrent',
    'transmission'
  ]);
  assert.deepEqual(composeServicesAffectedByEnvironment(compose, ['ROMM_API_KEY']), []);
  assert.deepEqual(
    changedEnvironmentKeys(
      { ROMM_IGDB_CLIENT_ID: 'before', ROMM_IGDB_CLIENT_SECRET: 'same' },
      { ROMM_IGDB_CLIENT_ID: 'after', ROMM_IGDB_CLIENT_SECRET: 'same' }
    ),
    ['ROMM_IGDB_CLIENT_ID']
  );

  assert.match(commands, /ServiceRuntimeApply:[\s\S]*args: \['service', 'apply'\]/);
  assert.match(route, /runQueuedTask\(runtimeApplyTask, command\)/);
  assert.match(directory, /group\.title === 'Metadata Providers'/);
  assert.match(directory, /Container update queued for/);
  assert.match(script, /write_compose_env_file/);
  assert.match(script, /up -d --force-recreate --no-deps "\$service"/);
});

test('security credential apply leaves the Stackarr controller running', async () => {
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/security.sh'), 'utf8');
  const runner = await readFile(path.join(repoRoot, 'apps/frontend/src/lib/runner.ts'), 'utf8');
  const commandActions = await readFile(path.join(repoRoot, 'packages/core/src/actions/commands.ts'), 'utf8');
  const serviceList = script.match(/security_service_list\(\) \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(serviceList);
  assert.doesNotMatch(serviceList, /services\+=\("app"\)/);
  assert.match(script, /Stackarr controller stays online because it reads account credentials from runtime storage/);
  assert.match(script, /STACKARR_TASK_HANDOFF_STARTED/);
  assert.match(script, /app-updater security apply-worker/);
  assert.match(script, /up -d --force-recreate --no-deps app/);
  assert.match(
    script,
    /task_database_url="\$\{STACKARR_DATABASE_URL:-\}"[\s\S]*?start_security_apply_worker "\$task_database_url"/
  );
  assert.match(script, /STACKARR_DATABASE_URL="\$STACKARR_TASK_DATABASE_URL" node "\$TASK_LOGGER"/);
  assert.match(runner, /commandStartedTaskHandoff\(command\.name, exitCode, output\)/);
  assert.match(commandActions, /commandStartedTaskHandoff\(definition\.name, exitCode, output\)/);
  const worker = script.match(/apply_security_worker\(\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(worker);
  assert.doesNotMatch(worker, /update_security_task_note "Applying managed service credentials"/);
  assert.match(
    worker,
    /apply_security[\s\S]*?update_security_task_note "Recreating the Stackarr controller with current database credentials"/
  );
});

test('security credential apply includes services that persist shared credentials', async () => {
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/security.sh'), 'utf8');
  const serviceList = script.match(/security_service_list\(\) \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(serviceList);
  assert.match(serviceList, /optional_service_enabled youtarr[\s\S]*services\+=\("youtarr"\)/);
  assert.match(script, /optional_service_enabled cleanuparr[\s\S]*cleanuparr-configure\.py/);
  assert.match(script, /cleanuparr-credentials\.py/);
  assert.match(script, /sync_pulsarr_admin_identity/);
  assert.match(script, /Pulsarr admin identity sync requires exactly one local admin/);
  assert.match(script, /scryptHash/);
  assert.match(script, /SET username = :'admin_username', password = :'admin_password_hash', updated_at = NOW\(\)/);
  assert.match(script, /sync_pulsarr_admin_identity \|\| credential_sync_failed=true/);
  assert.match(script, /cleanuparr-credentials\.py\" \|\| credential_sync_failed=true/);
  assert.match(script, /One or more managed service credentials could not be applied/);
});

test('Cleanuparr credential sync updates its single local owner and revokes sessions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cleanuparr-credentials-test-'));
  const database = path.join(root, 'users.db');
  const binDir = path.join(root, 'bin');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'htpasswd'),
      "#!/bin/sh\nprintf '%s\\n' ':$2a$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO123456789'\n"
    );
    await chmod(path.join(binDir, 'htpasswd'), 0o755);
    await execFile('sqlite3', [
      database,
      "CREATE TABLE users (username TEXT, password_hash TEXT, failed_login_attempts INTEGER, lockout_end TEXT, updated_at TEXT); INSERT INTO users VALUES ('admin', 'old', 3, 'later', 'before'); CREATE TABLE refresh_tokens (token TEXT); INSERT INTO refresh_tokens VALUES ('stale');"
    ]);

    const { stdout } = await execFile('python3', [path.join(repoRoot, 'stackarr/scripts/cleanuparr-credentials.py')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        USERNAME: 'shared-user',
        PASSWORD: 'shared-password',
        CLEANUPARR_USERS_DB: database
      }
    });
    const { stdout: state } = await execFile('sqlite3', [
      database,
      "SELECT username, password_hash LIKE '$2a$%', failed_login_attempts, lockout_end IS NULL, (SELECT COUNT(*) FROM refresh_tokens) FROM users;"
    ]);

    assert.match(stdout, /Cleanuparr shared credentials synced/);
    assert.equal(state.trim(), 'shared-user|1|0|1|0');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('saved secret fields expose only a middle-truncated preview', async () => {
  const { redactEnv } = await import('../../core/src/env.ts');
  const safe = redactEnv({
    ROMM_IGDB_CLIENT_SECRET: 'abcdefghijklmnop',
    MOBYGAMES_API_KEY: 'token123',
    TRACEARR_CLAIM_CODE: 'abc'
  });
  const directory = await readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.tsx'), 'utf8');

  assert.equal(safe.ROMM_IGDB_CLIENT_SECRET, 'abcdef...mnop');
  assert.equal(safe.MOBYGAMES_API_KEY, 'to...23');
  assert.equal(safe.TRACEARR_CLAIM_CODE, 'a...c');
  assert.match(directory, /placeholder=\{savedPreview\}/);
  assert.doesNotMatch(directory, /placeholder=\{saved \? 'Saved'/);
});

test('saving an unchanged secret preview preserves the original credential', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-secret-preview-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { readEnv, writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getServiceConfigAction, updateServiceConfigAction } = await import('./packages/core/src/serviceCatalog.ts');

          writeEnvConfig({
            PASSWORD: 'valid-admin-password',
            ROMM_IGDB_CLIENT_SECRET: 'abcdefghijklmnop'
          });
          const config = getServiceConfigAction({ service: 'romm' });
          const preview = config.groups
            .flatMap((group) => group.fields)
            .find((field) => field.id === 'rommIgdbClientSecret')?.value;
          const result = updateServiceConfigAction({
            service: 'romm',
            values: { rommIgdbClientSecret: preview }
          });
          console.log(JSON.stringify({
            accepted: result.accepted,
            preview,
            preserved: readEnv().ROMM_IGDB_CLIENT_SECRET === 'abcdefghijklmnop'
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
      accepted: true,
      preview: 'abcdef...mnop',
      preserved: true
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Youtarr service settings enforce upstream credential limits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-youtarr-credentials-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { updateServiceConfigAction } = await import('./packages/core/src/serviceCatalog.ts');

          const username = updateServiceConfigAction({
            service: 'youtarr',
            values: { youtarrAdminUsername: 'a'.repeat(33) }
          });
          const password = updateServiceConfigAction({
            service: 'youtarr',
            values: { youtarrAdminPassword: 'a'.repeat(65) }
          });
          console.log(JSON.stringify({
            usernameAccepted: username.accepted,
            usernameError: username.error,
            passwordAccepted: password.accepted,
            passwordError: password.error
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

    const result = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(result.usernameAccepted, false);
    assert.match(String(result.usernameError), /32 characters or fewer/);
    assert.equal(result.passwordAccepted, false);
    assert.match(String(result.passwordError), /64 characters or fewer/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
