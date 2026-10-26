import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createEngine } = require('../../../stackarr/scripts/storage-migrate.cjs');

type Fixture = ReturnType<typeof fixture>;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-storage-migrate-'));
  const source = path.join(root, 'app', 'config');
  const destination = path.join(root, 'external', 'config');
  const journal = path.join(root, 'app', 'storage-migration.json');
  const policyFile = path.join(root, 'app', 'storage-policy.json');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.dirname(destination));
  fs.mkdirSync(path.join(source, 'radarr'));
  fs.writeFileSync(path.join(source, 'radarr', 'config.xml'), 'secret fixture\n');
  fs.linkSync(path.join(source, 'radarr', 'config.xml'), path.join(source, 'radarr', 'hardlink.xml'));
  fs.symlinkSync('config.xml', path.join(source, 'radarr', 'relative-link.xml'));
  const records: Record<string, any> = {};
  let currentPolicy: any = { version: 1, roots: [], project: 'fixture' };
  const policy = {
    captureRoot: (p: string) => ({
      path: p,
      realPath: fs.existsSync(p) ? fs.realpathSync(p) : path.join(fs.realpathSync(path.dirname(p)), path.basename(p)),
      uuid: p.startsWith(path.dirname(destination)) ? 'external-uuid' : 'internal-uuid',
      mountPoint: p.startsWith(path.dirname(destination)) ? path.dirname(destination) : root,
      filesystem: 'apfs'
    }),
    verifyRoot: (r: any, opts: any) => {
      const got = policy.captureRoot(r.path);
      if (got.uuid !== r.uuid || (!opts?.allowMissingLeaf && got.realPath !== r.realPath))
        throw Error('volume changed');
    },
    checkPolicy: () => currentPolicy,
    readPolicy: () => currentPolicy,
    writePolicy: (_: string, p: any) => {
      currentPolicy = p;
      records.last = p;
    }
  };
  const containers: any[] = [];
  const deps = {
    policy,
    docker: () => containers,
    free: () => 10 ** 9,
    copy: (src: string, dst: string) => {
      execFileSync('rsync', ['-aH', `${src}/`, `${dst}/`]);
    }
  };
  const args = [source, destination, journal, policyFile] as const;
  return {
    root,
    source,
    destination,
    journal,
    policyFile,
    records,
    containers,
    deps,
    args,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
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

test('whole-tree copy verifies hashes/topology, retains original, guarded logical link and rollback', () =>
  withFixture((f) => {
    const { copy: _fixtureCopy, ...nativeCopyDeps } = f.deps;
    const engine = createEngine(nativeCopyDeps);
    assert.equal(engine.plan(...f.args).entries, 5);
    const result = engine.run(...f.args);
    assert.equal(result.phase, 'completed');
    assert.equal(fs.realpathSync(f.source), fs.realpathSync(f.destination));
    assert.equal(fs.readFileSync(path.join(f.destination, 'radarr/config.xml'), 'utf8'), 'secret fixture\n');
    assert.equal(fs.readFileSync(path.join(result.original, 'radarr/config.xml'), 'utf8'), 'secret fixture\n');
    assert.equal(f.records.last.project, 'fixture');
    assert.deepEqual(
      f.records.last.roots.map((r: any) => [r.path, r.realPath, r.uuid]),
      [[f.source, fs.realpathSync(f.destination), 'external-uuid']]
    );
    assert.equal(
      fs.statSync(path.join(f.destination, 'radarr/config.xml')).ino,
      fs.statSync(path.join(f.destination, 'radarr/hardlink.xml')).ino
    );
    assert.equal(fs.readlinkSync(path.join(f.destination, 'radarr/relative-link.xml')), 'config.xml');
    const undone = engine.rollback(f.journal, f.policyFile);
    assert.equal(undone.phase, 'rolled-back');
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(f.source, 'radarr/config.xml'), 'utf8'), 'secret fixture\n');
    assert.equal(fs.existsSync(f.destination), true);
  }));

test('modified destination refuses stale rollback and preserves both trees', () =>
  withFixture((f) => {
    const engine = createEngine(f.deps);
    const result = engine.run(...f.args);
    fs.writeFileSync(path.join(f.destination, 'radarr/config.xml'), 'new write');
    assert.throws(() => engine.rollback(f.journal, f.policyFile), /changed/);
    assert.equal(fs.readFileSync(path.join(result.original, 'radarr/config.xml'), 'utf8'), 'secret fixture\n');
    assert.equal(fs.realpathSync(f.source), fs.realpathSync(f.destination));
  }));

test('copy normalizes destination root permissions before verification', () =>
  withFixture((f) => {
    fs.chmodSync(f.source, 0o750);
    const engine = createEngine({
      ...f.deps,
      copy: (src: string, dst: string) => {
        f.deps.copy(src, dst);
        fs.chmodSync(dst, 0o700);
      }
    });
    assert.equal(engine.run(...f.args).phase, 'completed');
    assert.equal(fs.statSync(f.destination).mode & 0o7777, 0o750);
  }));

test('interrupted copy resumes with journal and leaves source untouched', () =>
  withFixture((f) => {
    const broken = createEngine({
      ...f.deps,
      copy: (src: string, dst: string) => {
        fs.copyFileSync(path.join(src, 'radarr/config.xml'), path.join(dst, 'partial'));
        throw Error('cancelled');
      }
    });
    assert.throws(() => broken.run(...f.args), /cancelled/);
    assert.equal(JSON.parse(fs.readFileSync(f.journal, 'utf8')).phase, 'copying');
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
    // An untracked partial entry must not pass the manifest comparison.
    assert.throws(() => createEngine(f.deps).run(...f.args), /changed/);
    fs.unlinkSync(path.join(f.destination, 'partial'));
    assert.equal(createEngine(f.deps).run(...f.args).phase, 'completed');
  }));

test('cutover crash resumes from retained original without starting writers', () =>
  withFixture((f) => {
    const engine = createEngine({
      ...f.deps,
      hook: (phase: string) => {
        if (phase === 'cutover-pending') throw Error('cancelled');
      }
    });
    assert.throws(() => engine.run(...f.args), /cancelled/);
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
    assert.equal(createEngine(f.deps).run(...f.args).phase, 'completed');
  }));

test('rollback can resume after interrupted unlink and rename', () =>
  withFixture((f) => {
    const engine = createEngine({
      ...f.deps,
      hook: (phase: string) => {
        if (phase === 'rollback-pending') throw Error('cancelled');
      }
    });
    const j = engine.run(...f.args);
    assert.throws(() => engine.rollback(f.journal, f.policyFile), /cancelled/);
    fs.unlinkSync(f.source);
    assert.equal(createEngine(f.deps).rollback(f.journal, f.policyFile).phase, 'rolled-back');
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
    assert.equal(fs.existsSync(j.original), false);
  }));

test('rejects Docker restart policy even if stopped and writable overlap', () =>
  withFixture((f) => {
    f.containers.push({
      State: { Running: false },
      HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
      Mounts: [{ Type: 'bind', RW: true, Source: f.source }]
    });
    assert.equal(createEngine(f.deps).plan(...f.args).source, f.source);
    assert.throws(() => createEngine(f.deps).run(...f.args), /automatic restart/);
    f.containers[0].HostConfig.RestartPolicy.Name = 'no';
    assert.throws(() => createEngine(f.deps).run(...f.args), /Remove existing container/);
    f.containers[0].State.Running = true;
    assert.throws(() => createEngine(f.deps).run(...f.args), /not confirmed stopped/);
    f.containers[0].State.Running = false;
    f.containers[0].Mounts[0].Source = fs.realpathSync(f.source);
    assert.throws(() => createEngine(f.deps).run(...f.args), /Remove existing container/);
  }));

test('rejects unsafe links, target occupancy, insufficient space and volume change before cutover', () =>
  withFixture((f) => {
    fs.symlinkSync('/etc/passwd', path.join(f.source, 'outside'));
    assert.throws(() => createEngine(f.deps).plan(...f.args), /Unsafe link/);
    fs.unlinkSync(path.join(f.source, 'outside'));
    assert.throws(() => createEngine({ ...f.deps, free: () => 0 }).plan(...f.args), /Insufficient/);
    fs.mkdirSync(f.destination);
    assert.throws(() => createEngine(f.deps).plan(...f.args), /absent/);
    fs.rmdirSync(f.destination);
    const engine = createEngine({
      ...f.deps,
      hook: (phase: string) => {
        if (phase === 'copied') throw Error('pause');
      }
    });
    assert.throws(() => engine.run(...f.args), /pause/);
    const changed = {
      ...f.deps.policy,
      verifyRoot: (r: any, opts: any) => {
        if (r.path === f.destination && !opts?.allowMissingLeaf) throw Error('volume changed');
        f.deps.policy.verifyRoot(r, opts);
      }
    };
    assert.throws(() => createEngine({ ...f.deps, policy: changed }).run(...f.args), /volume changed/);
    assert.equal(fs.lstatSync(f.source).isDirectory(), true);
  }));
