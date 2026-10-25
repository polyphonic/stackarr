import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL('../../../stackarr/scripts/storage-policy.cjs', import.meta.url));
type Envelope = { version: number; project?: string; roots: RecordRoot[] };
const policy: {
  inspectVolume: (root: string, options?: { probe?: (root: string) => Volume }) => Volume;
  captureRoot: (root: string, options?: Options) => RecordRoot;
  verifyRoot: (root: RecordRoot, options?: Options) => RecordRoot;
  readPolicy: (file: string) => Envelope;
  checkPolicy: (file: string, options?: Options) => Envelope;
  writePolicy: (file: string, envelope: Envelope) => void;
} = require(script);
type Volume = { mountPoint: string; uuid: string; filesystem: string; readOnly: boolean };
type RecordRoot = Omit<Volume, 'readOnly'> & { path: string; realPath: string };
type Options = { allowMissingLeaf?: boolean; probe?: (root: string) => Volume };

function fixture(run: (mount: string, root: string, volume: Volume) => void) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-policy-')));
  const mount = path.join(dir, 'External Drive');
  const root = path.join(mount, 'Application State');
  fs.mkdirSync(root, { recursive: true });
  try {
    run(mount, root, { mountPoint: mount, uuid: '1111-AAAA', filesystem: 'apfs', readOnly: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('pins mounted filesystem UUID even when replacement disk uses same mount name', () =>
  fixture((mount, root, volume) => {
    let current = volume;
    const probe = () => current;
    const captured = policy.captureRoot(root, { probe });
    assert.deepEqual(captured, {
      path: root,
      realPath: root,
      mountPoint: mount,
      uuid: '1111-AAAA',
      filesystem: 'apfs'
    });
    assert.deepEqual(policy.verifyRoot(captured, { probe }), captured);
    current = { ...volume, uuid: '2222-BBBB' };
    assert.throws(() => policy.verifyRoot(captured, { probe }), /identity changed/);
  }));

test('stale directory on parent filesystem cannot masquerade as missing mounted device', () =>
  fixture((mount, root, volume) => {
    const captured = policy.captureRoot(root, { probe: () => volume });
    const parent = path.dirname(mount);
    assert.throws(
      () => policy.verifyRoot(captured, { probe: () => ({ ...volume, mountPoint: parent, uuid: 'PARENT' }) }),
      /identity changed|escapes/
    );
    assert.throws(
      () => policy.inspectVolume(root, { probe: () => ({ ...volume, mountPoint: `${mount}Other` }) }),
      /reported mount/
    );
  }));

test('rejects read-only and unsupported network, FAT and exFAT filesystems', () =>
  fixture((_, root, volume) => {
    assert.equal(policy.inspectVolume(root, { probe: () => ({ ...volume, readOnly: true }) }).readOnly, true);
    assert.throws(() => policy.captureRoot(root, { probe: () => ({ ...volume, readOnly: true }) }), /read-only/);
    for (const filesystem of ['exfat', 'msdos', 'vfat', 'nfs', 'smbfs', 'cifs', 'overlay']) {
      assert.throws(
        () => policy.captureRoot(root, { probe: () => ({ ...volume, filesystem }) }),
        /unsupported/,
        filesystem
      );
    }
  }));

test('symlink retargeting and traversal are rejected', () =>
  fixture((mount, root, volume) => {
    const other = path.join(mount, 'Other');
    fs.mkdirSync(other);
    const link = path.join(mount, 'Link');
    fs.symlinkSync(root, link);
    const captured = policy.captureRoot(link, { probe: () => volume });
    fs.unlinkSync(link);
    fs.symlinkSync(other, link);
    assert.throws(() => policy.verifyRoot(captured, { probe: () => volume }), /retargeted/);
    assert.throws(
      () =>
        policy.captureRoot(path.join(mount, 'Other', '..', 'Application State') + '/../Other', { probe: () => volume }),
      /traversal/
    );
  }));

test('missing leaf requires opt-in and a present parent anchored on captured volume', () =>
  fixture((mount, root, volume) => {
    const missing = path.join(root, 'Not Yet Created');
    assert.throws(() => policy.captureRoot(missing, { probe: () => volume }), /ENOENT/);
    const captured = policy.captureRoot(missing, { allowMissingLeaf: true, probe: () => volume });
    assert.equal(fs.existsSync(missing), false);
    assert.deepEqual(policy.verifyRoot(captured, { allowMissingLeaf: true, probe: () => volume }), captured);
    assert.throws(
      () => policy.captureRoot(path.join(missing, 'nested'), { allowMissingLeaf: true, probe: () => volume }),
      /ENOENT/
    );
    assert.throws(
      () =>
        policy.verifyRoot(captured, {
          allowMissingLeaf: true,
          probe: () => ({ ...volume, mountPoint: path.dirname(mount), uuid: 'PARENT' })
        }),
      /identity changed|escapes/
    );
  }));

test('atomic policy write uses mode 0600, read and check verify every record', () =>
  fixture((mount, root, volume) => {
    const filename = path.join(path.dirname(mount), 'policy.json');
    assert.deepEqual(policy.readPolicy(filename), { version: 1, roots: [] });
    const captured = policy.captureRoot(root, { probe: () => volume });
    policy.writePolicy(filename, { version: 1, project: 'stackarr_test', roots: [captured] });
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.deepEqual(policy.readPolicy(filename), { version: 1, project: 'stackarr_test', roots: [captured] });
    assert.deepEqual(policy.checkPolicy(filename, { probe: () => volume }), {
      version: 1,
      project: 'stackarr_test',
      roots: [captured]
    });
    assert.throws(
      () => policy.writePolicy(filename, { version: 1, project: '', roots: [] }),
      /invalid storage policy project/
    );
    assert.throws(
      () => policy.writePolicy(filename, { version: 1, project: '../invalid', roots: [] }),
      /invalid storage policy project/
    );
    assert.throws(() => policy.checkPolicy(filename, { probe: () => ({ ...volume, readOnly: true }) }), /read-only/);
    assert.throws(() => policy.writePolicy(filename, { version: 2, roots: [] }), /invalid storage policy/);
    assert.deepEqual(
      fs.readdirSync(path.dirname(filename)).filter((name) => name.endsWith('.tmp')),
      []
    );
  }));

test('CLI check prints safe status without revealing configured paths', () =>
  fixture((mount) => {
    const filename = path.join(path.dirname(mount), 'policy.json');
    policy.writePolicy(filename, { version: 1, roots: [] });
    const stdout = execFileSync(process.execPath, [script, 'check', filename], { encoding: 'utf8' });
    assert.equal(stdout.trim(), 'storage policy safe');
    assert.ok(!stdout.includes(mount));
  }));
