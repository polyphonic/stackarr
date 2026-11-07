import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StackarrEnv } from '../../core/src/env';
import { configuredDiskUsages, type DiskUsage, groupDiskUsages } from '../../core/src/metrics';
import { composeProjectName } from '../../core/src/paths';
import { collectServiceStorage, discoverServiceStorage, plexLibraryLocations } from '../../core/src/serviceStorage';

for (const logRoot of ['/mnt/Logs/stackarr', '/container-logs']) {
  test(`configured report includes the log volume and ownership for LOG_ROOT=${logRoot}`, async () => {
    const previousRuntime = process.env.STACKARR_RUNTIME;
    process.env.STACKARR_RUNTIME = 'docker';
    try {
      const hostLogs = '/mnt/Logs/stackarr';
      const env = {
        CONFIG_ROOT: '/host/config',
        STATE_ROOT: '/host/state',
        LOG_ROOT: logRoot,
        BACKUP_ROOT: '/mnt/Archive/backups',
        ENABLE_BACKUP: 'false',
        STACKARR_PG_BACKUP_ENABLED: 'false'
      } as StackarrEnv;
      const probed: string[] = [];
      const probe = (paths: string[]): DiskUsage[] =>
        paths.map((path) => {
          probed.push(path);
          const logs = path === hostLogs;
          return {
            path,
            label: path,
            paths: [path],
            filesystem: logs ? '/dev/log-fixture' : null,
            mountPoint: logs ? '/mnt/Logs' : null,
            totalSpace: logs ? 2048 : null,
            freeSpace: logs ? 1024 : null,
            usedPercent: logs ? 50 : null,
            status: logs ? 'available' : 'not-enrolled'
          };
        });
      const report = await configuredDiskUsages(env, probe, (configured) =>
        discoverServiceStorage(configured, {
          services: () =>
            [{ name: 'stackarr', mode: 'docker', dockerService: 'app' }] as ReturnType<
              typeof import('../../core/src/services').getServices
            >,
          containers: async () => [
            {
              Config: {
                Labels: {
                  'com.docker.compose.project': composeProjectName,
                  'com.docker.compose.service': 'app'
                }
              },
              State: { Running: true },
              Mounts: [
                { Type: 'bind', Source: env.CONFIG_ROOT, Destination: '/stackarr-config' },
                { Type: 'bind', Source: env.STATE_ROOT, Destination: env.STATE_ROOT },
                { Type: 'bind', Source: hostLogs, Destination: logRoot },
                { Type: 'bind', Source: '/mnt/SD/unrelated-games', Destination: '/unused-games' }
              ]
            }
          ],
          libraries: async () => []
        })
      );
      const logs = report.find((disk) => disk.paths.includes(hostLogs));
      assert.ok(logs, 'the separately configured log volume must appear in the production report');
      assert.equal(logs.totalSpace, 2048);
      assert.equal(logs.freeSpace, 1024);
      assert.equal(logs.mountPoint, '/mnt/Logs');
      assert.deepEqual(logs.associations, [
        {
          path: hostLogs,
          service: 'stackarr',
          displayName: 'Stackarr',
          reason: 'LOG_ROOT',
          source: 'configuration',
          status: 'available'
        },
        {
          path: hostLogs,
          service: 'stackarr',
          displayName: 'Stackarr',
          reason: `Bind: ${logRoot}`,
          source: 'container-bind',
          status: 'available'
        }
      ]);
      const expectedPaths = ['/host/config', '/host/state', '/mnt/Archive/backups', hostLogs].sort();
      assert.deepEqual(report.flatMap((disk) => disk.paths).sort(), expectedPaths);
      assert.deepEqual(probed.sort(), expectedPaths, 'probe only associated host paths, once each, never the SD bind');
      assert.ok(report.some((disk) => disk.associations?.some((association) => association.service === 'backup')));
    } finally {
      if (previousRuntime === undefined) delete process.env.STACKARR_RUNTIME;
      else process.env.STACKARR_RUNTIME = previousRuntime;
    }
  });
}

test('configured reports use the current controller namespace, including nested and shadowing mounts', async () => {
  const container = (service: string, source: string, running = true) => ({
    Config: { Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': service } },
    State: { Running: running },
    Mounts: [
      { Type: 'bind', Source: source, Destination: '/config' },
      { Type: 'bind', Source: `${source}/special`, Destination: '/config/nested' },
      { Type: 'volume', Source: '/daemon/volume', Destination: '/config/private' }
    ]
  });
  for (const runtime of ['docker', 'docker-updater', 'host']) {
    for (const controllerService of ['stackarr', 'app']) {
      const roots = collectServiceStorage({
        env: { CONFIG_ROOT: '/config/nested/app', STATE_ROOT: '/config/private/state' } as StackarrEnv,
        services: [...services],
        project: 'fixture',
        runtime,
        libraries: [],
        containers: [
          container(controllerService, '/host/current'),
          container('app', '/host/stale', false),
          container('app-updater', '/host/updater')
        ]
      });
      const paths = [...new Set(roots.map((r) => r.path))];
      if (runtime === 'host') assert.deepEqual(paths, ['/config/nested/app', '/config/private/state']);
      else assert.deepEqual(paths, [`/host/${runtime === 'docker' ? 'current' : 'updater'}/special/app`]);
      assert.ok(!paths.some((p) => p.includes('/daemon/') || p.includes('/host/stale')));
    }
  }
  const ambiguous = collectServiceStorage({
    env: { CONFIG_ROOT: '/config/nested/app' } as StackarrEnv,
    services: [...services],
    project: 'fixture',
    runtime: 'docker',
    libraries: [],
    containers: [container('stackarr', '/host/new'), container('app', '/host/old')]
  });
  assert.ok(!ambiguous.some((root) => root.path.startsWith('/host/')));
});

const services = [
  { name: 'stackarr', mode: 'docker', dockerService: 'stackarr' },
  { name: 'plex', mode: 'native' },
  { name: 'tdarr', mode: 'docker', dockerService: 'tdarr' },
  { name: 'backup', mode: 'disabled' },
  { name: 'romm', mode: 'disabled', dockerService: 'romm' }
] as const;

test('managed binds map host sources, exclude disabled app mounts, foreign projects, named volumes and temporary cards', () => {
  const env = {
    MEDIA_ROOT: '/Volumes/Media',
    BACKUP_ROOT: '/Volumes/Archive/backups',
    CONFIG_ROOT: '/host/config',
    ROMM_LIBRARY_ROOT: '/Volumes/SD-Card/games'
  } as StackarrEnv;
  const roots = collectServiceStorage({
    env,
    services: [...services],
    project: 'fixture',
    libraries: [],
    containers: [
      {
        Config: { Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'app' } },
        Mounts: [
          { Type: 'bind', Source: '/Volumes/SD-Card/games', Destination: '/stackarr-romm-library' },
          { Type: 'bind', Source: '/Volumes/Archive/backups', Destination: '/backups' },
          { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' },
          { Type: 'volume', Source: '/host/docker/volumes/volume', Destination: '/state' }
        ]
      },
      {
        Config: { Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'tdarr' } },
        Mounts: [{ Type: 'bind', Source: '/Volumes/Extra/tdarr-cache', Destination: '/temp' }]
      },
      {
        Config: { Labels: { 'com.docker.compose.project': 'other', 'com.docker.compose.service': 'tdarr' } },
        Mounts: [{ Type: 'bind', Source: '/Volumes/SD-Card/foreign', Destination: '/temp' }]
      }
    ]
  });
  assert.ok(
    roots.some((r) => r.path === '/Volumes/Extra/tdarr-cache' && r.service === 'tdarr' && r.source === 'container-bind')
  );
  assert.ok(roots.some((r) => r.path === '/Volumes/Archive/backups' && r.service === 'backup'));
  assert.ok(
    !roots.some((r) => r.path.includes('SD-Card') || r.path.includes('docker.sock') || r.path.includes('/host/docker/'))
  );
});

test('native Plex adapter discovers library-only volume without fetching an unrelated SD card', async () => {
  const plex = { name: 'plex', mode: 'native' as const };
  const report = await discoverServiceStorage({} as StackarrEnv, {
    services: () => [plex] as ReturnType<typeof import('../../core/src/services').getServices>,
    containers: async () => [],
    libraries: async () =>
      plexLibraryLocations({
        MediaContainer: {
          Directory: [{ Location: [{ path: '/Volumes/PlexOnly/films' }] }, { Location: [{ path: 'relative/SD-card' }] }]
        }
      })
  });
  assert.deepEqual(
    report.roots.map((r) => r.path),
    ['/Volumes/PlexOnly/films']
  );
  assert.deepEqual(report.issues, []);
});

test('groups verified same-UUID aliases with both owners but never coalesces an unverified sibling', () => {
  const make = (path: string, volumeId?: string) => ({
    label: path,
    path,
    paths: [path],
    filesystem: volumeId ? '/dev/disk7' : null,
    mountPoint: volumeId ? '/Volumes/Shared' : null,
    freeSpace: volumeId ? 800 : null,
    totalSpace: volumeId ? 1000 : null,
    usedPercent: volumeId ? 20 : null,
    ...(volumeId ? { volumeId } : {}),
    associations: [
      {
        path,
        service: path.includes('plex') ? 'plex' : 'backup',
        reason: 'Location',
        source: 'configuration' as const,
        status: volumeId ? ('available' as const) : ('not-enrolled' as const)
      }
    ]
  });
  for (const pair of [
    [make('/logical/plex', 'same-uuid'), make('/Volumes/Shared/backups', 'same-uuid')],
    [make('/Volumes/Shared/backups', 'same-uuid'), make('/logical/plex', 'same-uuid')]
  ]) {
    const disks = groupDiskUsages([...pair, make('/Volumes/Shared/stale')]);
    assert.equal(disks.length, 2);
    assert.equal(disks[0].volumeId, 'same-uuid');
    assert.equal(disks[0].paths.length, 2);
    assert.deepEqual(disks[0].associations?.map((a) => a.service).sort(), ['backup', 'plex']);
    assert.equal(disks[1].totalSpace, null);
  }
});

test('discovers native Plex-only library, Tdarr media/cache and on-demand backups, not unrelated disks', () => {
  const roots = collectServiceStorage({
    env: {
      CONFIG_ROOT: '/host/config',
      STATE_ROOT: '/host/state',
      TDARR_MEDIA_ROOT: '/Volumes/Video/media',
      TDARR_CACHE_ROOT: '/Volumes/Cache/transcodes',
      BACKUP_ROOT: '/Volumes/Archive/backups',
      BACKUP_STAGING_ROOT: '/Volumes/Archive/staging',
      ENABLE_BACKUP: 'false',
      STACKARR_PG_BACKUP_ENABLED: 'false',
      ROMM_LIBRARY_ROOT: '/Volumes/Unused/games'
    } as StackarrEnv,
    services: [...services],
    containers: [],
    libraries: [{ service: 'plex', path: '/Volumes/PrivateLibrary/movies', reason: 'Library location' }]
  });
  assert.deepEqual(
    [...new Set(roots.map((r) => r.path))].sort(),
    [
      '/Volumes/Archive/backups',
      '/Volumes/Archive/staging',
      '/Volumes/Cache/transcodes',
      '/Volumes/PrivateLibrary/movies',
      '/Volumes/Video/media',
      '/host/config',
      '/host/state'
    ].sort()
  );
  assert.ok(roots.some((r) => r.service === 'backup' && r.reason === 'Backup Root'));
  assert.ok(roots.some((r) => r.service === 'tdarr' && r.reason === 'Transcode Cache'));
  assert.ok(roots.some((r) => r.service === 'tdarr' && r.reason === 'Media Folder'));
  assert.ok(!roots.some((r) => r.path.includes('Unused') || r.path.includes('SD')));
});
