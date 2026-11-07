import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StackarrEnv } from '../../core/src/env';
import { configuredDiskUsages, diskUsages, parseFilesystemUsage, resolveHostDiskPath } from '../../core/src/metrics';

test('external paths are probed at bound subdirectories before grouping under a volume label', () => {
  const seen: string[] = [];
  const disks = diskUsages(['/Volumes/External/Backups/Stackarr', '/Volumes/External/Media'], (diskPath) => {
    seen.push(diskPath);
    return {
      label: '/Volumes/External',
      path: '/Volumes/External',
      paths: [diskPath],
      filesystem: 'virtiofs',
      mountPoint: '/Volumes/External',
      freeSpace: 800,
      totalSpace: 1000,
      usedPercent: 20
    };
  });
  assert.deepEqual(seen, ['/Volumes/External/Backups/Stackarr', '/Volumes/External/Media']);
  assert.equal(disks.length, 1);
  assert.deepEqual(disks[0].paths, seen);
});

test('configured disk report shares host-aware probe, groups volumes and preserves unavailable capacity', async () => {
  const seen: string[] = [];
  const env = {
    MEDIA_ROOT: '/Volumes/External/Media',
    MUSIC_ROOT: '/Volumes/External/Music',
    DOWNLOADS_ROOT: '/Volumes/External/Downloads',
    BACKUP_ROOT: '/Volumes/External/Backups',
    CONFIG_ROOT: '/stackarr-config',
    STATE_ROOT: '/stackarr-state'
  } as StackarrEnv;
  const disks = await configuredDiskUsages(
    env,
    (paths) =>
      diskUsages(paths, (diskPath) => {
        seen.push(diskPath);
        const internal = diskPath.startsWith('/stackarr-');
        return {
          label: internal ? 'Macintosh HD' : '/Volumes/External',
          path: internal ? '/stackarr-internal' : '/Volumes/External',
          paths: [diskPath],
          filesystem: internal ? null : '/dev/disk7',
          mountPoint: internal ? null : '/Volumes/External',
          freeSpace: internal ? null : 800 * 1024,
          totalSpace: internal ? null : 1000 * 1024,
          usedPercent: internal ? null : 20
        };
      }),
    async () => ({
      roots: Object.values(env).map((value) => ({
        path: value,
        service: 'stackarr',
        reason: 'Configured root',
        source: 'configuration' as const
      })),
      issues: []
    })
  );
  assert.deepEqual(seen, Object.values(env));
  assert.equal(disks.length, 3);
  const external = disks.find((disk) => disk.path === '/Volumes/External');
  const internal = disks.find((disk) => disk.path === '/stackarr-internal');
  assert.deepEqual(external?.paths, seen.slice(0, 4));
  assert.equal(external?.freeSpace, 800 * 1024);
  assert.equal(external?.totalSpace, 1000 * 1024);
  assert.deepEqual(
    disks
      .filter((d) => d.totalSpace === null)
      .flatMap((d) => d.paths)
      .sort(),
    seen.slice(4).sort()
  );
  assert.equal(internal?.freeSpace, null);
  assert.equal(internal?.totalSpace, null);
});

test('configured report preserves every path status before grouping in either order', async () => {
  const paths = ['/Volumes/Archive/backups', '/Volumes/Archive/media', '/Volumes/Archive/config', '/logical/config'];
  const roots = paths.map((path, index) => ({
    path,
    service: ['backup', 'plex', 'stackarr', 'tdarr'][index],
    reason: 'Location',
    source: 'configuration' as const
  }));
  for (const ordered of [roots, [...roots].reverse()]) {
    const disks = await configuredDiskUsages(
      {} as StackarrEnv,
      (values) =>
        diskUsages(values, (requested) => {
          const status = requested.endsWith('backups')
            ? 'not-enrolled'
            : requested.endsWith('media')
              ? 'unmounted'
              : 'available';
          return {
            label: '/Volumes/Archive',
            path: '/Volumes/Archive',
            paths: [requested],
            status,
            filesystem: status === 'available' ? '/dev/verified' : null,
            mountPoint: status === 'available' ? '/Volumes/Archive' : null,
            freeSpace: status === 'available' ? 800 : null,
            totalSpace: status === 'available' ? 1000 : null,
            usedPercent: status === 'available' ? 20 : null,
            ...(status === 'available' ? { volumeId: 'verified-uuid' } : {})
          };
        }),
      async () => ({ roots: ordered, issues: [] })
    );
    const associations = disks.flatMap((disk) => disk.associations ?? []);
    assert.equal(associations.find((a) => a.service === 'backup')?.status, 'not-enrolled');
    assert.equal(associations.find((a) => a.service === 'plex')?.status, 'unmounted');
    assert.equal(associations.find((a) => a.service === 'stackarr')?.status, 'available');
    assert.equal(associations.find((a) => a.service === 'tdarr')?.status, 'available');
    assert.equal(disks.length, 3);
    assert.deepEqual(disks.find((d) => d.volumeId)?.paths.sort(), paths.slice(2).sort());
    assert.equal(disks.filter((d) => d.totalSpace === null).length, 2);
  }
});

const mounts = [
  { Type: 'bind', Source: '/host/external/Backups/Stackarr', Destination: '/Volumes/External/Backups/Stackarr' },
  { Type: 'bind', Source: '/host/internal/config', Destination: '/stackarr-config' },
  { Type: 'bind', Source: '/host/external', Destination: '/Volumes/External' }
];

test('storage probe keeps the bound subdirectory instead of probing its external volume root', () => {
  assert.equal(resolveHostDiskPath('/Volumes/External/Backups/Stackarr', mounts), '/host/external/Backups/Stackarr');
  assert.equal(
    resolveHostDiskPath('/Volumes/External/Backups/Stackarr/archive', mounts),
    '/host/external/Backups/Stackarr/archive'
  );
  assert.equal(resolveHostDiskPath('/Volumes/External/media', mounts), '/host/external/media');
  assert.equal(resolveHostDiskPath('/stackarr-config', mounts), '/host/internal/config');
  assert.equal(resolveHostDiskPath('/stackarr-config/app', mounts), '/host/internal/config/app');
  assert.equal(resolveHostDiskPath('/unbound/overlay/path', mounts), null);
});

test('host macOS df -kP output has no filesystem-type column', () => {
  const result = parseFilesystemUsage(
    'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk7s1 976557744 166328576 810026868 18% /Volumes/External\n',
    false,
    true
  );
  assert.equal(result?.totalKilobytes, 976557744);
  assert.equal(result?.availableKilobytes, 810026868);
  assert.equal(result?.usedPercent, 18);
  assert.equal(result?.mountPoint, '/Volumes/External');
});

test('helper df parses single bind filesystem instead of Docker VM overlay', () => {
  const result = parseFilesystemUsage(
    'Filesystem Type 1024-blocks Used Available Capacity Mounted on\nvirtiofs virtiofs 11721045168 10980000000 741045168 94% /stackarr-storage-probe\n',
    true
  );
  assert.equal(result?.totalKilobytes, 11721045168);
  assert.equal(result?.availableKilobytes, 741045168);
  assert.equal(result?.type, 'virtiofs');
  assert.equal(parseFilesystemUsage('bad output', true), null);
});
