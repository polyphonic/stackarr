import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { diskUsages, hostMountPoint } from '../../core/src/metrics';

test('verified volume capacity wins over an unavailable sibling path in either order', () => {
  const volume = '/Volumes/Portable';
  const backup = `${volume}/Backups`;
  const config = '/opt/stackarr/config';
  for (const paths of [
    [backup, config],
    [config, backup]
  ]) {
    const disks = diskUsages(paths, (diskPath) => ({
      label: volume,
      path: volume,
      paths: [diskPath],
      filesystem: diskPath === config ? '/dev/verified' : null,
      mountPoint: diskPath === config ? volume : null,
      freeSpace: diskPath === config ? 600000 : null,
      totalSpace: diskPath === config ? 1000000 : null,
      usedPercent: diskPath === config ? 40 : null
    }));
    assert.equal(disks.length, 1);
    assert.equal(disks[0].totalSpace, 1000000);
    assert.equal(disks[0].freeSpace, 600000);
    assert.equal(disks[0].filesystem, '/dev/verified');
    assert.equal(disks[0].mountPoint, volume);
    assert.deepEqual(disks[0].paths, paths);
  }
});

test('dashboard groups a relocated logical config bind under its physical disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-relocated-metrics-'));
  const state = path.join(dir, 'state');
  const logical = path.join(dir, 'config');
  const volume = '/Volumes/Portable';
  fs.mkdirSync(state);
  fs.mkdirSync(logical);
  try {
    fs.writeFileSync(
      path.join(state, 'storage-policy.json'),
      JSON.stringify({
        version: 1,
        roots: [{ path: logical, realPath: `${volume}/Stackarr/config`, mountPoint: volume }]
      })
    );
    // Docker inspect returns the logical bind source, not the resolved host symlink.
    const disks = diskUsages([logical, `${volume}/Backups`], (diskPath) => {
      const mountPoint = hostMountPoint(diskPath, state);
      return {
        label: mountPoint,
        path: mountPoint,
        paths: [diskPath],
        filesystem: 'mac (virtiofs)',
        mountPoint,
        freeSpace: 600000,
        totalSpace: 1000000,
        usedPercent: 40
      };
    });
    assert.equal(disks.length, 1);
    assert.equal(disks[0].path, volume);
    assert.equal(disks[0].label, volume);
    assert.deepEqual(disks[0].paths, [logical, `${volume}/Backups`]);
    assert.equal(disks[0].totalSpace, 1000000);
    assert.equal(hostMountPoint(path.join(logical, 'sonarr'), state), volume);
    assert.equal(hostMountPoint('/opt/internal', state), '/');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid or missing policy cannot claim an unrelated external volume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-relocated-metrics-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'storage-policy.json'),
      JSON.stringify({
        roots: [{ path: '/opt/config', realPath: '/elsewhere/config', mountPoint: '/Volumes/Portable' }]
      })
    );
    assert.equal(hostMountPoint('/opt/config', dir), '/');
    assert.equal(hostMountPoint('/opt/config', path.join(dir, 'absent')), '/');
    assert.equal(hostMountPoint('/Volumes/Other/data', dir), '/Volumes/Other');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
