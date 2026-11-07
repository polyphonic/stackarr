import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const policy = require('../../../stackarr/scripts/storage-policy.cjs') as {
  captureRoot: (root: string, options?: Options) => Root;
  verifyRoot: (root: Root, options?: Options) => Root;
  checkPolicy: (file: string, options?: Options) => Policy;
  readPolicy: (file: string) => Policy;
  writePolicy: (file: string, value: Policy) => void;
};
const { createEngine } = require('../../../stackarr/scripts/storage-migrate.cjs');
const { checkHost } = require('../../../stackarr/scripts/storage-control.cjs');

type Volume = { mountPoint: string; uuid: string; filesystem: string; readOnly: boolean };
type Options = { allowMissingLeaf?: boolean; probe?: (resolved: string) => Volume };
type Root = Omit<Volume, 'readOnly'> & { path: string; realPath: string };
type Policy = { version: number; project?: string; roots: Root[]; migration?: unknown };
type Container = {
  State: { Running: boolean };
  Config?: { Labels?: Record<string, string> };
  HostConfig: { RestartPolicy: { Name: string } };
  Mounts: { Type: string; RW: boolean; Source: string }[];
};

type Fixture = ReturnType<typeof fixture>;
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-storage-e2e-')));
  const internal = path.join(base, 'internal');
  const external = path.join(base, 'external');
  const source = path.join(internal, 'config');
  const destination = path.join(external, 'config');
  const state = path.join(internal, 'state');
  const journal = path.join(state, 'storage-migration.json');
  const policyFile = path.join(state, 'storage-policy.json');
  fs.mkdirSync(path.join(source, 'radarr'), { recursive: true });
  fs.mkdirSync(external);
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(source, 'radarr', 'config.xml'), 'fixture config\n');
  fs.linkSync(path.join(source, 'radarr', 'config.xml'), path.join(source, 'radarr', 'hardlink.xml'));
  fs.symlinkSync('config.xml', path.join(source, 'radarr', 'relative-link.xml'));
  let externalUuid = 'fixture-external-uuid';
  const probe = (resolved: string): Volume => {
    const isExternal = resolved === external || resolved.startsWith(`${external}${path.sep}`);
    return {
      mountPoint: isExternal ? external : base,
      uuid: isExternal ? externalUuid : 'fixture-internal-uuid',
      filesystem: 'apfs',
      readOnly: false
    };
  };
  // Only OS volume discovery is substituted. The policy's capture, verification,
  // persistence, and migration's native copy/manifest/cutover remain real.
  const adapter = {
    captureRoot: (root: string, options: Options = {}) => policy.captureRoot(root, { ...options, probe }),
    verifyRoot: (root: Root, options: Options = {}) => policy.verifyRoot(root, { ...options, probe }),
    checkPolicy: (file: string, options: Options = {}) => policy.checkPolicy(file, { ...options, probe }),
    readPolicy: policy.readPolicy,
    writePolicy: policy.writePolicy
  };
  const containers: Container[] = [];
  const engine = (extras: Record<string, unknown> = {}) =>
    createEngine({ policy: adapter, docker: () => containers, ...extras });
  const args = [source, destination, journal, policyFile] as const;
  policy.writePolicy(policyFile, { version: 1, project: 'fixture', roots: [] });
  const hostCheck = () => checkHost(policyFile, adapter.checkPolicy);
  return {
    base,
    external,
    source,
    destination,
    journal,
    policyFile,
    args,
    containers,
    engine,
    hostCheck,
    adapter,
    replaceUuid: (uuid: string) => {
      externalUuid = uuid;
    },
    cleanup: () => fs.rmSync(base, { recursive: true, force: true })
  };
}
function withFixture(fn: (f: Fixture) => void) {
  const f = fixture();
  try {
    fn(f);
  } finally {
    f.cleanup();
  }
}
function originalContents(root: string) {
  assert.equal(fs.readFileSync(path.join(root, 'radarr/config.xml'), 'utf8'), 'fixture config\n');
  assert.equal(
    fs.statSync(path.join(root, 'radarr/config.xml')).ino,
    fs.statSync(path.join(root, 'radarr/hardlink.xml')).ino
  );
  assert.equal(fs.readlinkSync(path.join(root, 'radarr/relative-link.xml')), 'config.xml');
}

test('real policy and native copy carry plan, guarded logical cutover, and rollback', () =>
  withFixture((f) => {
    f.hostCheck();
    const planned = f.engine().plan(...f.args);
    assert.equal(planned.entries, 5);
    assert.equal(planned.roots.source.uuid, 'fixture-internal-uuid');
    assert.equal(planned.roots.destination.uuid, 'fixture-external-uuid');
    const completed = f.engine().run(...f.args);
    assert.equal(completed.phase, 'completed');
    assert.equal(fs.lstatSync(f.source).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(f.source), f.destination);
    originalContents(f.destination);
    originalContents(completed.original);
    const recorded = policy.readPolicy(f.policyFile);
    assert.equal(fs.statSync(f.policyFile).mode & 0o777, 0o600);
    assert.deepEqual(recorded.roots, [{ ...planned.roots.destination, path: f.source }]);
    assert.equal(recorded.roots[0].path, f.source);
    assert.equal(recorded.roots[0].realPath, f.destination);
    assert.deepEqual(f.adapter.checkPolicy(f.policyFile), recorded);
    f.hostCheck();
    const rolled = f.engine().rollback(f.journal, f.policyFile);
    assert.equal(rolled.phase, 'rolled-back');
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
    originalContents(f.source);
    assert.deepEqual(policy.readPolicy(f.policyFile), { version: 1, project: 'fixture', roots: [] });
    f.hostCheck();
  }));

test('native copy preserves literal AppleDouble sidecars as well as their metadata', () =>
  withFixture((f) => {
    // Minimal portable AppleDouble FinderInfo entry, with no personal metadata.
    const sidecar = Buffer.alloc(70);
    sidecar.writeUInt32BE(0x00051607, 0);
    sidecar.writeUInt32BE(0x00020000, 4);
    sidecar.writeUInt16BE(1, 24);
    sidecar.writeUInt32BE(9, 26);
    sidecar.writeUInt32BE(38, 30);
    sidecar.writeUInt32BE(32, 34);
    sidecar.write('STKA', 38, 'ascii');
    fs.writeFileSync(path.join(f.source, '._radarr'), sidecar, { mode: 0o600 });
    const completed = f.engine().run(...f.args);
    assert.equal(completed.phase, 'completed');
    assert.deepEqual(fs.readFileSync(path.join(f.destination, '._radarr')), sidecar);
    assert.equal(fs.statSync(path.join(f.destination, '._radarr')).mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(path.join(completed.original, '._radarr')), sidecar);
    assert.equal(f.engine().rollback(f.journal, f.policyFile).phase, 'rolled-back');
  }));

test('resume reuses verified data despite volatile Finder metadata in an older journal', () =>
  withFixture((f) => {
    const finderFile = path.join(f.source, '.DS_Store');
    fs.writeFileSync(finderFile, 'old folder view');
    assert.throws(
      () =>
        f
          .engine({
            hook: (phase: string) => {
              if (phase === 'copied') throw new Error('simulated pre-commit interruption');
            }
          })
          .run(...f.args),
      /simulated pre-commit interruption/
    );
    const journal = JSON.parse(fs.readFileSync(f.journal, 'utf8'));
    const stat = fs.statSync(finderFile);
    journal.phase = 'copying';
    journal.snapshot.entries.push({
      path: '.DS_Store',
      type: 'file',
      mode: stat.mode & 0o7777,
      uid: stat.uid,
      gid: stat.gid,
      size: stat.size,
      sha256: createHash('sha256').update(fs.readFileSync(finderFile)).digest('hex'),
      hardlink: null
    });
    journal.snapshot.digest = createHash('sha256').update(JSON.stringify(journal.snapshot.entries)).digest('hex');
    fs.writeFileSync(f.journal, JSON.stringify(journal));
    fs.writeFileSync(finderFile, 'new folder view');
    fs.writeFileSync(path.join(f.destination, 'radarr', '.DS_Store'), 'another view');
    const completed = f.engine({ copy: () => assert.fail('verified copy was needlessly repeated') }).run(...f.args);
    assert.equal(completed.phase, 'completed');
    originalContents(f.destination);
    originalContents(completed.original);
    fs.writeFileSync(path.join(f.destination, 'radarr', 'config.xml'), 'changed application data');
    assert.throws(() => f.engine().rollback(f.journal, f.policyFile), /changed/);
  }));

test('copy crash leaves source intact and host guard closed; rollback restores prior policy', () =>
  withFixture((f) => {
    const interrupted = f.engine({
      copy: (_source: string, destination: string) => {
        fs.writeFileSync(path.join(destination, 'partial'), 'interrupted');
        throw new Error('simulated copy crash');
      }
    });
    assert.throws(() => interrupted.run(...f.args), /simulated copy crash/);
    assert.equal(JSON.parse(fs.readFileSync(f.journal, 'utf8')).phase, 'copying');
    assert.throws(f.hostCheck, /unfinished/);
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
    originalContents(f.source);
    assert.equal(f.engine().rollback(f.journal, f.policyFile).phase, 'rolled-back');
    originalContents(f.source);
    assert.deepEqual(policy.readPolicy(f.policyFile).roots, []);
    f.hostCheck();
  }));

test('stale destination refuses rollback without discarding either tree', () =>
  withFixture((f) => {
    const completed = f.engine().run(...f.args);
    fs.writeFileSync(path.join(f.destination, 'radarr/config.xml'), 'changed after cutover');
    assert.throws(() => f.engine().rollback(f.journal, f.policyFile), /changed/);
    originalContents(completed.original);
    assert.equal(fs.readFileSync(path.join(f.source, 'radarr/config.xml'), 'utf8'), 'changed after cutover');
    assert.equal(JSON.parse(fs.readFileSync(f.journal, 'utf8')).phase, 'completed');
  }));

test('policy and host guard fail on logical symlink retarget or replacement UUID', () =>
  withFixture((f) => {
    f.engine().run(...f.args);
    const other = path.join(f.external, 'other');
    fs.mkdirSync(other);
    fs.unlinkSync(f.source);
    fs.symlinkSync(other, f.source);
    assert.throws(() => f.adapter.checkPolicy(f.policyFile), /retargeted/);
    assert.throws(f.hostCheck, /retargeted/);
    fs.unlinkSync(f.source);
    fs.symlinkSync(f.destination, f.source);
    f.replaceUuid('replacement-volume-uuid');
    assert.throws(() => f.adapter.checkPolicy(f.policyFile), /identity changed/);
    assert.throws(f.hostCheck, /identity changed/);
  }));

test('running and stopped overlapping bind consumers refuse migration without real Docker', () =>
  withFixture((f) => {
    const consumer: Container = {
      State: { Running: true },
      Config: { Labels: { 'com.docker.compose.project': 'fixture' } },
      HostConfig: { RestartPolicy: { Name: 'no' } },
      Mounts: [{ Type: 'bind', RW: true, Source: f.source }]
    };
    f.containers.push(consumer);
    assert.throws(() => f.engine().run(...f.args), /Stop every Stackarr container/);
    consumer.State.Running = false;
    assert.throws(() => f.engine().run(...f.args), /Remove existing container/);
    consumer.HostConfig.RestartPolicy.Name = 'unless-stopped';
    assert.throws(() => f.engine().run(...f.args), /automatic restart/);
    assert.equal(fs.existsSync(f.journal), false);
    originalContents(f.source);
  }));

const externalParent = process.env.STACKARR_STORAGE_TEST_EXTERNAL_PARENT;
test('optional native volume identity and default cross-volume copy/rollback', { skip: !externalParent }, () => {
  if (!externalParent) return;
  const internal = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-storage-native-internal-')));
  let external: string | undefined;
  try {
    const parent = fs.realpathSync(externalParent);
    external = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'stackarr-storage-native-external-')));
    const source = path.join(internal, 'config');
    const destination = path.join(external, 'config');
    const state = path.join(internal, 'state');
    fs.mkdirSync(source);
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(source, 'config.xml'), 'native fixture\n');
    const sourceVolume = policy.captureRoot(source);
    const destVolume = policy.captureRoot(destination, { allowMissingLeaf: true });
    assert.notEqual(sourceVolume.uuid, destVolume.uuid, 'external parent must be on another volume');
    const journal = path.join(state, 'storage-migration.json');
    const policyFile = path.join(state, 'storage-policy.json');
    policy.writePolicy(policyFile, { version: 1, project: 'fixture', roots: [] });
    const engine = createEngine({ docker: () => [] });
    assert.equal(engine.plan(source, destination, journal, policyFile).entries, 2);
    const completed = engine.run(source, destination, journal, policyFile);
    assert.equal(completed.phase, 'completed');
    assert.equal(fs.realpathSync(source), fs.realpathSync(destination));
    assert.equal(fs.readFileSync(path.join(destination, 'config.xml'), 'utf8'), 'native fixture\n');
    assert.equal(policy.checkPolicy(policyFile).roots[0].uuid, destVolume.uuid);
    checkHost(policyFile);
    assert.equal(engine.rollback(journal, policyFile).phase, 'rolled-back');
    assert.equal(fs.lstatSync(source).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(source, 'config.xml'), 'utf8'), 'native fixture\n');
    checkHost(policyFile);
  } finally {
    fs.rmSync(internal, { recursive: true, force: true });
    if (external) fs.rmSync(external, { recursive: true, force: true });
  }
});
