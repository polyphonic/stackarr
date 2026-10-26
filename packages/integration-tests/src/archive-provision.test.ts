import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const script = path.join(repo, 'stackarr/scripts/archive-hooks-configure.sh');

test('rendered downloader config and Arr torrent-state mounts share independent CONFIG_ROOT', async () => {
  const config = '/fixture/relocated/config';
  const { stdout } = await execFile(
    'docker',
    [
      'compose',
      '-f',
      path.join(repo, 'stackarr/docker-compose.yml'),
      '--profile',
      'transmission',
      '--profile',
      'qbittorrent',
      '--profile',
      'tv',
      '--profile',
      'sonarr4k',
      '--profile',
      'movies',
      '--profile',
      'radarr4k',
      'config',
      '--format',
      'json'
    ],
    { env: { ...process.env, APP_ROOT: '/fixture/app', CONFIG_ROOT: config } }
  );
  const services = JSON.parse(stdout).services as Record<
    string,
    { volumes: Array<{ source: string; target: string }> }
  >;
  const mount = (service: string, target: string) => services[service].volumes.find((v) => v.target === target)?.source;
  assert.equal(mount('transmission', '/config'), `${config}/transmission`);
  assert.equal(mount('qbittorrent', '/config'), `${config}/qbittorrent`);
  for (const arr of ['sonarr', 'sonarr4k', 'radarr', 'radarr4k']) {
    assert.equal(mount(arr, '/torrent-client-state/transmission'), `${mount('transmission', '/config')}/torrents`);
    assert.equal(
      mount(arr, '/torrent-client-state/qbittorrent'),
      `${mount('qbittorrent', '/config')}/qBittorrent/BT_backup`
    );
  }
});

test('archive scripts exist before notification validation without requiring a naming API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-archive-install-'));
  try {
    const config = path.join(root, 'config');
    await execFile('bash', [script, 'install'], {
      env: {
        ...process.env,
        APP_ROOT: root,
        CONFIG_ROOT: config,
        STATE_ROOT: path.join(root, 'state'),
        STACKARR_DATABASE_FILE: path.join(root, 'empty.db'),
        ENABLE_TV_SHOWS: 'true',
        ENABLE_4K_SERVARR: 'true',
        SONARR_URL: 'http://127.0.0.1:1',
        SONARR_4K_URL: 'http://127.0.0.1:1'
      }
    });
    for (const name of [
      'archive-torrent.sh',
      'archive-torrent-4k.sh',
      'torrent-seasons.py',
      'torrent-seasons.sh',
      'torrent-seasons.awk'
    ]) {
      await access(path.join(config, 'hooks', name));
    }
    const configure = await readFile(path.join(repo, 'stackarr/scripts/configure.sh'), 'utf8');
    assert.match(configure, /archive-hooks-configure\.sh" install/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('archive provisioning copies classifier and isolates standard/4K naming from each Arr API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-archive-provision-'));
  try {
    const config = path.join(root, 'config');
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    for (const name of ['sonarr', 'sonarr4k', 'radarr', 'radarr4k']) {
      await mkdir(path.join(config, name), { recursive: true });
      await writeFile(path.join(config, name, 'config.xml'), '<ApiKey>fixture</ApiKey>');
    }
    const curl = path.join(bin, 'curl');
    await writeFile(
      curl,
      `#!/bin/sh
case "$*" in
  *sonarr4k*/api/v3/config/naming*) printf '%s' '{"seasonFolderFormat":"Series {season:00}","specialsFolderFormat":"4K Specials"}' ;;
  *sonarr*/api/v3/config/naming*) printf '%s' '{"seasonFolderFormat":"Season {season}","specialsFolderFormat":"Specials"}' ;;
  *) exit 1 ;;
esac
`
    );
    await chmod(curl, 0o755);
    await execFile('bash', [script, 'provision'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        APP_ROOT: root,
        CONFIG_ROOT: config,
        STATE_ROOT: path.join(root, 'state'),
        STACKARR_DATABASE_FILE: path.join(root, 'empty.db'),
        ENABLE_TV_SHOWS: 'true',
        ENABLE_MOVIES: 'false',
        ENABLE_4K_SERVARR: 'true',
        SONARR_URL: 'http://sonarr',
        SONARR_4K_URL: 'http://sonarr4k'
      }
    });
    const hooks = path.join(config, 'hooks');
    assert.deepEqual(JSON.parse(await readFile(path.join(hooks, 'sonarr-naming.json'), 'utf8')), {
      seasonFolderFormat: 'Season {season}',
      specialsFolderFormat: 'Specials'
    });
    assert.deepEqual(JSON.parse(await readFile(path.join(hooks, 'sonarr4k-naming.json'), 'utf8')), {
      seasonFolderFormat: 'Series {season:00}',
      specialsFolderFormat: '4K Specials'
    });
    assert.match(await readFile(path.join(hooks, 'archive-torrent-4k.sh'), 'utf8'), /sonarr4k-naming\.json/);
    assert.deepEqual(
      await readFile(path.join(hooks, 'torrent-seasons.py')),
      await readFile(path.join(repo, 'stackarr/scripts/hooks/torrent-seasons.py'))
    );
    for (const name of ['torrent-seasons.sh', 'torrent-seasons.awk']) {
      assert.deepEqual(
        await readFile(path.join(hooks, name)),
        await readFile(path.join(repo, 'stackarr/scripts/hooks', name))
      );
    }
    await access(path.join(hooks, 'archive-torrent.sh'));
    // The narrow apply mode updates only the matching notification in each
    // instance, retaining the server's existing fields and other settings.
    await writeFile(
      curl,
      `#!/bin/sh
case "$*" in
  *sonarr4k*/api/v3/config/naming*) printf '%s' '{"seasonFolderFormat":"Series {season:00}","specialsFolderFormat":"4K Specials"}' ;;
  *sonarr*/api/v3/config/naming*) printf '%s' '{"seasonFolderFormat":"Season {season}","specialsFolderFormat":"Specials"}' ;;
  *-X\\ PUT*) printf '%s\\n' "$*" >> '${path.join(root, 'puts')}'; printf '{}' ;;
  *sonarr4k*/api/v3/notification*) printf '%s' '[{"id":9,"name":"Stackarr Torrent Archive","onGrab":false,"onDownload":false,"onUpgrade":false,"tags":[7],"fields":[{"name":"path","value":"/old"},{"name":"other","value":"retained"}]}]' ;;
  *sonarr*/api/v3/notification*) printf '%s' '[{"id":5,"name":"Stackarr Torrent Archive","onGrab":false,"onDownload":false,"onUpgrade":false,"tags":[7],"fields":[{"name":"path","value":"/old"}]}]' ;;
  *radarr4k*/api/v3/notification*) printf '%s' '[{"id":8,"name":"Stackarr Torrent Archive","onGrab":false,"onDownload":false,"onUpgrade":false,"tags":[7],"fields":[{"name":"path","value":"/old"}]}]' ;;
  *radarr*/api/v3/notification*) printf '%s' '[{"id":4,"name":"Stackarr Torrent Archive","onGrab":false,"onDownload":false,"onUpgrade":false,"tags":[7],"fields":[{"name":"path","value":"/old"}]}]' ;;
  *) exit 1 ;;
esac
`
    );
    await execFile('bash', [script, 'apply'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        APP_ROOT: root,
        CONFIG_ROOT: config,
        STATE_ROOT: path.join(root, 'state'),
        STACKARR_DATABASE_FILE: path.join(root, 'empty.db'),
        ENABLE_TV_SHOWS: 'true',
        ENABLE_MOVIES: 'true',
        ENABLE_4K_SERVARR: 'true',
        SONARR_URL: 'http://sonarr',
        SONARR_4K_URL: 'http://sonarr4k',
        RADARR_URL: 'http://radarr',
        RADARR_4K_URL: 'http://radarr4k'
      }
    });
    const puts = await readFile(path.join(root, 'puts'), 'utf8');
    assert.match(puts, /sonarr4k\/api\/v3\/notification\/9/);
    assert.match(puts, /sonarr\/api\/v3\/notification\/5/);
    assert.match(puts, /radarr4k\/api\/v3\/notification\/8/);
    assert.match(puts, /radarr\/api\/v3\/notification\/4/);
    assert.match(puts, /archive-torrent-4k\.sh/);
    assert.match(puts, /retained/);
    const updates = puts.trim().split('\n');
    assert.equal(updates.length, 4);
    for (const update of updates) {
      const payload = JSON.parse(update.match(/--data (\{.*\}) http:\/\//)?.[1] ?? 'null');
      assert.equal(payload.onGrab, true);
      assert.equal(payload.onDownload, true);
      assert.equal(payload.onUpgrade, true);
      assert.deepEqual(payload.tags, [7]);
      assert.equal(
        payload.fields.find((field: { name: string }) => field.name === 'path').value.startsWith('/stackarr-hooks/'),
        true
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
