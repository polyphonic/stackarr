import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createInitFixture, initAnswers } from './helpers/init-fixture';

const require = createRequire(import.meta.url);
const { resolvePaths, composeSource, assertReady, recordReady } = require('../../../stackarr/scripts/media-paths.cjs');
const source = fs.readFileSync(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');
const base = {
  MEDIA_PATH_LAYOUT: 'shared',
  MEDIA_ROOT: '/srv/Media',
  DOWNLOADS_ROOT: '/srv/Media/Downloads',
  TORRENT_ARCHIVE_ROOT: '/srv/Media/Downloads/torrents',
  TDARR_MEDIA_ROOT: '/srv/Media',
  TDARR_CACHE_ROOT: '/srv/Media/Downloads/transcodes',
  STATE_ROOT: '/srv/App/state'
};
test('init preserves the saved layout across fresh, pre-layout, shared and legacy SQLite installs', () => {
  const fixture = createInitFixture();
  try {
    for (const [name, stored, expected] of [
      ['fresh', null, 'shared'],
      ['pre-layout', false, 'legacy'],
      ['shared', { MEDIA_PATH_LAYOUT: 'shared' }, 'shared'],
      ['legacy', { MEDIA_PATH_LAYOUT: 'legacy' }, 'legacy']
    ] as const) {
      const root = path.join(fixture.root, name);
      const dbFile = path.join(root, 'config', 'stackarr.db');
      if (stored !== null) {
        fs.mkdirSync(path.dirname(dbFile), { recursive: true });
        const db = new DatabaseSync(dbFile);
        db.exec(
          "create table app_settings (key text primary key, value text not null, updated_at text not null default (datetime('now')))"
        );
        if (stored)
          db.prepare('insert into app_settings (key, value) values (?, ?)').run(
            'stackarr.runtimeConfig',
            JSON.stringify(stored)
          );
        db.close();
      }
      const result = fixture.run(
        [path.join(fixture.sourceRoot, 'scripts', 'init.sh')],
        {
          ...fixture.environment(root),
          MEDIA_PATH_LAYOUT: expected === 'shared' ? 'legacy' : 'shared'
        },
        initAnswers(stored !== null)
      );
      assert.equal(result.status, 0, `${name}: ${result.stderr}\n${result.stdout}`);
      fixture.assertUntouched();
      const db = new DatabaseSync(dbFile, { readOnly: true });
      const row = db.prepare('select value from app_settings where key = ?').get('stackarr.runtimeConfig') as
        | { value: string }
        | undefined;
      db.close();
      const saved = JSON.parse(row?.value ?? '{}');
      assert.equal(saved.MEDIA_PATH_LAYOUT, expected, name);
      assert.equal(saved.DOWNLOADS_ROOT, expected === 'shared' ? `${root}/media/Downloads` : `${root}/downloads`, name);
      const rendered = composeSource(source, saved);
      const radarr = rendered.split('  radarr:\n')[1]?.split(/^  [\w-]+:/m)[0] ?? '';
      if (expected === 'shared') {
        assert.match(radarr, new RegExp(`${root}/media:/data`));
        assert.doesNotMatch(radarr, /:\/downloads/);
      } else {
        assert.equal(rendered, source, name);
        assert.match(radarr, /\$\{MEDIA_ROOT:-\.\/\.stackarr\/media\}\/Movies:\/movies/);
        assert.match(radarr, /\$\{DOWNLOADS_ROOT:-\.\/\.stackarr\/downloads\}:\/downloads/);
      }
    }
  } finally {
    fixture.close();
  }
});

test('shared contract uses real relative paths and a single parent bind', () => {
  const result = resolvePaths(base);
  assert.equal(result.paths.CONTAINER_TV_ROOT, '/data/TV Shows');
  assert.equal(result.paths.CONTAINER_DOWNLOADS_ROOT, '/data/Downloads');
  assert.equal(result.paths.CONTAINER_TDARR_CACHE_ROOT, '/data/Downloads/transcodes');
  assert.equal(result.paths.CONTAINER_TORRENT_ARCHIVE_ROOT, '/data/Downloads/torrents');
  assert.deepEqual(result.bindings.downloads, result.bindings.media);
});
test('existing settings retain legacy paths and original Compose verbatim', () => {
  assert.equal(resolvePaths({}).paths.CONTAINER_MOVIES_ROOT, '/movies');
  assert.equal(composeSource(source, {}), source);
});
test('independent downloads and scratch use honest separate mounts', () => {
  const r = resolvePaths({ ...base, DOWNLOADS_ROOT: '/srv/SSD/Downloads', TDARR_CACHE_ROOT: '/srv/SSD/Scratch' });
  assert.equal(r.paths.CONTAINER_DOWNLOADS_ROOT, '/external/downloads');
  assert.equal(r.paths.CONTAINER_TDARR_CACHE_ROOT, '/external/tdarr-cache');
  assert.equal(r.bindings.media.source, '/srv/Media');
});
test('independent roots render separate, non-overlapping mounts for each consumer', () => {
  const env = {
    ...base,
    DOWNLOADS_ROOT: '/srv/SSD/Downloads',
    TORRENT_ARCHIVE_ROOT: '/srv/Archive',
    TDARR_CACHE_ROOT: '/srv/Scratch'
  };
  const output = composeSource(source, env);
  for (const service of ['radarr', 'sonarr', 'radarr4k', 'sonarr4k']) {
    const block = output.split(`  ${service}:\n`)[1]?.split(/^  [\w-]+:/m)[0];
    assert.match(block ?? '', /\/srv\/Media:\/data/);
    assert.match(block ?? '', /\/srv\/SSD\/Downloads:\/external\/downloads/);
    assert.match(block ?? '', /\/srv\/Archive:\/external\/torrent-archive/);
  }
  const tdarr = output.split('  tdarr:\n')[1]?.split(/^  [\w-]+:/m)[0];
  assert.match(tdarr ?? '', /\/srv\/Media:\/data/);
  assert.match(tdarr ?? '', /\/srv\/Scratch:\/external\/tdarr-cache/);
  assert.doesNotMatch(tdarr ?? '', /\/srv\/Scratch:\/data/);
});
test('invalid root and prefix-lookalike are never promoted to the shared parent', () => {
  for (const MEDIA_ROOT of ['/', 'relative', '/srv/../Media', '/srv/Media\nother'])
    assert.throws(() => resolvePaths({ ...base, MEDIA_ROOT }));
  assert.equal(
    resolvePaths({ ...base, DOWNLOADS_ROOT: '/srv/Media-other' }).paths.CONTAINER_DOWNLOADS_ROOT,
    '/external/downloads'
  );
});
test('real Compose rendering retains config and removes only pipeline aliases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-compose-'));
  try {
    const env = {
      ...base,
      MEDIA_ROOT: '/srv/Media $ library',
      DOWNLOADS_ROOT: '/srv/Media $ library/Downloads',
      TORRENT_ARCHIVE_ROOT: '/srv/Media $ library/Downloads/torrents',
      TDARR_MEDIA_ROOT: '/srv/Media $ library',
      TDARR_CACHE_ROOT: '/srv/Media $ library/Downloads/transcodes'
    };
    const file = path.join(dir, 'compose.yml');
    fs.writeFileSync(file, composeSource(source, env));
    const result = JSON.parse(
      execFileSync(
        'docker',
        ['compose', '--project-directory', dir, '-f', file, '--profile', '*', 'config', '--format', 'json'],
        {
          env: { ...process.env, ...env, ...resolvePaths(env).paths },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
    );
    for (const app of ['radarr', 'radarr4k', 'sonarr', 'sonarr4k', 'tdarr']) {
      const mounts = result.services[app].volumes;
      assert.equal(mounts.filter((m: { target: string }) => m.target === '/data').length, 1, app);
      assert.equal(
        mounts.find((m: { target: string }) => m.target === '/data').source,
        env.MEDIA_ROOT.replaceAll('$', () => '$$')
      );
      assert.ok(
        !mounts.some((m: { target: string }) =>
          ['/downloads', '/movies', '/tv', '/media', '/temp', '/torrent-archive'].includes(m.target)
        ),
        app
      );
    }
    const agregarrMedia = result.services.agregarr.volumes.filter((m: { target: string }) =>
      m.target.startsWith('/data')
    );
    assert.deepEqual(
      agregarrMedia.map((m: { source: string; target: string }) => [m.source, m.target]),
      [
        [`${env.MEDIA_ROOT.replaceAll('$', () => '$$')}/Movies`, '/data/Movies'],
        [`${env.MEDIA_ROOT.replaceAll('$', () => '$$')}/TV Shows`, '/data/TV Shows']
      ]
    );
    assert.equal(
      result.services.transmission.volumes.some((m: { target: string }) => m.target === '/data'),
      false
    );
    assert.equal(
      result.services.transmission.volumes.find((m: { target: string }) => m.target === '/data/Downloads').source,
      `${env.MEDIA_ROOT.replaceAll('$', () => '$$')}/Downloads`
    );
    assert.equal(
      result.services.bazarr.volumes.some((m: { target: string }) => m.target === '/data'),
      false
    );
    assert.equal(result.services.transmission.environment.TRANSMISSION_DOWNLOAD_DIR, '/data/Downloads/complete');
    assert.ok(result.services.tinymediamanager.volumes.some((m: { target: string }) => m.target === '/media'));
    assert.equal(composeSource(fs.readFileSync(file, 'utf8'), env), fs.readFileSync(file, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('migration gate checks app-local configurator state outside CONFIG_ROOT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-app-state-'));
  const env = {
    ...base,
    APP_ROOT: path.join(dir, 'app'),
    CONFIG_ROOT: path.join(dir, 'custom-config'),
    STATE_ROOT: path.join(dir, 'state'),
    QUESTARR_DATA_ROOT: path.join(dir, 'questarr-state')
  };
  try {
    for (const folder of [path.join(env.APP_ROOT, 'config', 'agregarr'), env.QUESTARR_DATA_ROOT]) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'settings.json'), '{}');
      assert.throws(() => assertReady(env), /migration/);
      fs.rmSync(folder, { recursive: true });
    }
    assertReady(env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('migration gate permits new installs and same-root reapply, rejects unconverted existing config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-gate-'));
  const env = { ...base, STATE_ROOT: path.join(dir, 'state'), CONFIG_ROOT: path.join(dir, 'config') };
  try {
    assertReady(env);
    fs.mkdirSync(path.join(env.CONFIG_ROOT, 'radarr'), { recursive: true });
    fs.writeFileSync(path.join(env.CONFIG_ROOT, 'radarr', 'config.xml'), '<Config/>');
    assert.throws(() => assertReady(env), /migration/);
    recordReady(env);
    assertReady(env);
    assert.throws(() => assertReady({ ...env, DOWNLOADS_ROOT: '/srv/Other' }), /changed/);
    assertReady({ ...env, MEDIA_PATH_LAYOUT: 'legacy' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
