import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const suiteRoot = await mkdtemp(path.join(tmpdir(), 'stackarr-lidarr-suite-'));
process.env.STACKARR_DATABASE_FILE = path.join(suiteRoot, 'stackarr.db');
delete process.env.STACKARR_DATABASE_URL;
delete process.env.STACKARR_RUNTIME;

after(async () => {
  await rm(suiteRoot, { recursive: true, force: true });
});

const responses = {
  system: { version: '3.1.0', startTime: '2026-08-21T20:00:00Z', isDocker: true, databaseType: 'postgreSQL' },
  health: [{ type: 'warning', source: 'IndexerStatusCheck', message: 'One indexer is unavailable.' }],
  roots: [{ id: 1, path: '/music', accessible: true, freeSpace: 1234, unmappedFolders: [{ name: 'Manual' }] }],
  download: { id: 2, enableCompletedDownloadHandling: false, removeCompletedDownloads: false },
  media: { id: 3, renameTracks: false, copyUsingHardlinks: true, importExtraFiles: true },
  indexers: [
    {
      id: 4,
      name: 'Music indexer',
      protocol: 'torrent',
      enableRss: true,
      enableAutomaticSearch: true,
      enableInteractiveSearch: true,
      priority: 25,
      fields: [{ name: 'apiKey', value: 'must-not-leak' }]
    }
  ],
  artists: [
    {
      id: 5,
      path: '/music/Artist',
      rootFolderPath: '/music',
      monitored: true,
      statistics: { trackFileCount: 8, trackCount: 10 }
    }
  ],
  queue: { totalRecords: 0 }
};

test('managed restricted profiles receive narrow Lidarr status, manual indexing, and mount tools', async () => {
  const { getMcpToolCatalog } = await import('@stackarr/core');
  const managed = getMcpToolCatalog({ profile: 'manage', enabledServices: ['lidarr'], groups: ['apps'] });
  const observed = getMcpToolCatalog({ profile: 'observe', enabledServices: ['lidarr'], groups: ['apps'] });
  const names = managed.map((tool) => tool.name);
  assert.ok(names.includes('stackarr_get_lidarr_library_status'));
  assert.ok(names.includes('stackarr_configure_lidarr_manual_library'));
  assert.ok(names.includes('stackarr_update_lidarr_music_mount'));
  assert.ok(observed.some((tool) => tool.name === 'stackarr_get_lidarr_library_status'));
  assert.ok(!observed.some((tool) => tool.name === 'stackarr_update_lidarr_music_mount'));
  const mountTool = managed.find((tool) => tool.name === 'stackarr_update_lidarr_music_mount');
  assert.equal(mountTool?.risk, 'dangerous');
  assert.deepEqual(mountTool?.scopes, ['apps:dangerous']);
});

test('Lidarr library status is compact, secret-safe, and explains indexing/manual mode', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-lidarr-status-'));
  const previousDatabaseFile = process.env.STACKARR_DATABASE_FILE;
  const previousFetch = globalThis.fetch;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');
  globalThis.fetch = async (input) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith('/system/status')) return Response.json(responses.system);
    if (pathname.endsWith('/health')) return Response.json(responses.health);
    if (pathname.endsWith('/rootfolder')) return Response.json(responses.roots);
    if (pathname.endsWith('/config/downloadclient')) return Response.json(responses.download);
    if (pathname.endsWith('/config/mediamanagement')) return Response.json(responses.media);
    if (pathname.endsWith('/indexer')) return Response.json(responses.indexers);
    if (pathname.endsWith('/artist')) return Response.json(responses.artists);
    if (pathname.endsWith('/queue')) return Response.json(responses.queue);
    throw new Error(`Unexpected Lidarr path: ${pathname}`);
  };

  try {
    const { getLidarrLibraryStatusAction, writeEnvConfig } = await import('@stackarr/core');
    writeEnvConfig({ ENABLE_LIDARR: 'true', LIDARR_URL: 'http://mock-lidarr.invalid', LIDARR_API_KEY: 'test-key' });
    const status = await getLidarrLibraryStatusAction();
    assert.equal(status.manualLibrary.completedDownloadHandling, false);
    assert.equal(status.manualLibrary.renameTracks, false);
    assert.equal(status.roots[0]?.path, '/music');
    assert.equal(status.roots[0]?.unmappedFolderCount, 1);
    assert.equal(status.library.roots['/music']?.trackFiles, 8);
    assert.deepEqual(status.indexers[0], {
      id: 4,
      name: 'Music indexer',
      protocol: 'torrent',
      enableRss: true,
      enableAutomaticSearch: true,
      enableInteractiveSearch: true,
      priority: 25
    });
    assert.doesNotMatch(JSON.stringify(status), /must-not-leak/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDatabaseFile === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabaseFile;
    await rm(root, { recursive: true, force: true });
  }
});

test('manual Lidarr reconciliation disables movers, scans /music, polls completion, and verifies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-lidarr-manual-'));
  const previousDatabaseFile = process.env.STACKARR_DATABASE_FILE;
  const previousFetch = globalThis.fetch;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');
  let download = { ...responses.download, enableCompletedDownloadHandling: true };
  let media = { ...responses.media, renameTracks: true };
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, pathname, body });
    if (method === 'PUT' && pathname.endsWith('/config/downloadclient/2')) {
      download = body as typeof download;
      return Response.json(download);
    }
    if (method === 'PUT' && pathname.endsWith('/config/mediamanagement/3')) {
      media = body as typeof media;
      return Response.json(media);
    }
    if (method === 'POST' && pathname.endsWith('/command')) return Response.json({ id: 9 });
    if (pathname.endsWith('/command/9')) return Response.json({ id: 9, status: 'completed' });
    if (pathname.endsWith('/system/status')) return Response.json(responses.system);
    if (pathname.endsWith('/health')) return Response.json([]);
    if (pathname.endsWith('/rootfolder')) return Response.json(responses.roots);
    if (pathname.endsWith('/config/downloadclient')) return Response.json(download);
    if (pathname.endsWith('/config/mediamanagement')) return Response.json(media);
    if (pathname.endsWith('/indexer')) return Response.json(responses.indexers);
    if (pathname.endsWith('/artist')) return Response.json(responses.artists);
    if (pathname.endsWith('/queue')) return Response.json(responses.queue);
    throw new Error(`Unexpected Lidarr request: ${method} ${pathname}`);
  };

  try {
    const { configureLidarrManualLibraryAction, writeEnvConfig } = await import('@stackarr/core');
    writeEnvConfig({ ENABLE_LIDARR: 'true', LIDARR_URL: 'http://mock-lidarr.invalid', LIDARR_API_KEY: 'test-key' });
    const result = await configureLidarrManualLibraryAction();
    assert.deepEqual(result.changed, ['completedDownloadHandling', 'renameTracks']);
    assert.equal(result.rescan?.status, 'completed');
    assert.equal(result.status.manualLibrary.completedDownloadHandling, false);
    assert.equal(result.status.manualLibrary.renameTracks, false);
    assert.ok(
      requests.some(
        (request) =>
          request.method === 'POST' &&
          request.pathname.endsWith('/command') &&
          (request.body as { folders?: string[] })?.folders?.[0] === '/music'
      )
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDatabaseFile === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabaseFile;
    await rm(root, { recursive: true, force: true });
  }
});

test('Lidarr mount changes are dry-run by default and stay under MEDIA_ROOT', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-lidarr-mount-'));
  const media = path.join(root, 'Media');
  const previous = path.join(media, 'OldMusic');
  const requested = path.join(media, 'Music');
  await mkdir(previous, { recursive: true });
  await mkdir(requested, { recursive: true });
  const previousDatabaseFile = process.env.STACKARR_DATABASE_FILE;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');

  try {
    const { updateLidarrMusicMountAction, writeEnvConfig } = await import('@stackarr/core');
    writeEnvConfig({ MEDIA_ROOT: media, MUSIC_ROOT: previous });
    const plan = await updateLidarrMusicMountAction({ musicRoot: requested });
    assert.equal(plan.dryRun, true);
    assert.equal(plan.requestedHostRoot, requested);
    await assert.rejects(
      updateLidarrMusicMountAction({ musicRoot: path.join(root, 'Outside') }),
      /within the configured MEDIA_ROOT/
    );
  } finally {
    if (previousDatabaseFile === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabaseFile;
    await rm(root, { recursive: true, force: true });
  }
});
