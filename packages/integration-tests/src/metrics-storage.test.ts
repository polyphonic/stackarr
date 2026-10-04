import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diskUsages, parseFilesystemUsage, resolveHostDiskPath } from '../../core/src/metrics';

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
