import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const control = require('../../../stackarr/scripts/storage-control.cjs');
const { render } = require('../../../stackarr/scripts/storage-monitor-install.cjs');
const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-storage-control-'));
  const file = path.join(dir, 'storage-policy.json');
  writeFileSync(file, JSON.stringify({ version: 1, project: 'fixture', roots: [] }));
  mkdirSync(control.bridgeDir(file));
  return { dir, file };
}

test('host bridge requires a fresh nonce-bound affirmative response', async () => {
  const { dir, file } = fixture();
  try {
    const timer = setInterval(() => control.respond(file, () => {}), 20);
    try {
      await control.checkGuest(file, { timeout: 1000 });
    } finally {
      clearInterval(timer);
    }
    const denied = setInterval(
      () =>
        control.respond(file, () => {
          throw new Error('wrong UUID');
        }),
      20
    );
    try {
      await assert.rejects(control.checkGuest(file, { timeout: 1000 }), /blocked/);
    } finally {
      clearInterval(denied);
    }
    await assert.rejects(control.checkGuest(file, { timeout: 120 }), /blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('host capacity is limited to enrolled roots and internal control state', () => {
  const { dir, file } = fixture();
  try {
    const root = path.join(dir, 'media');
    mkdirSync(root);
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        project: 'fixture',
        roots: [{ path: root, realPath: root, mountPoint: root, uuid: 'fixture', filesystem: 'apfs' }]
      })
    );
    const run = (_bin: string, args: string[]) => {
      assert.deepEqual(args, ['-kP', root]);
      return `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk9s1 11718883328 10801067928 916617768 93% ${root}\n`;
    };
    const usage = control.usageForRoot(file, root, run);
    assert.equal(usage.totalKilobytes, 11718883328);
    assert.equal(usage.mountPoint, root);
    assert.throws(() => control.usageForRoot(file, '/etc', run), /Unenrolled/);
    assert.throws(() => control.usageForRoot(file, `${root}/child`, run), /Unenrolled/);
    assert.throws(
      () =>
        control.usageForRoot(
          file,
          root,
          () => 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk9s1 100 50 50 50% /\n'
        ),
      /Invalid host capacity/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unfinished journal blocks boot even when every volume is present', () => {
  const { dir, file } = fixture();
  try {
    writeFileSync(path.join(dir, 'storage-migration.json'), JSON.stringify({ phase: 'copying' }));
    assert.throws(() => control.checkHost(file, () => {}), /unfinished/);
    writeFileSync(path.join(dir, 'storage-migration.json'), JSON.stringify({ phase: 'completed' }));
    control.checkHost(file, () => {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dangling migration journal symlink blocks host checks', () => {
  const { dir, file } = fixture();
  try {
    symlinkSync(path.join(dir, 'missing-journal'), path.join(dir, 'storage-migration.json'));
    assert.throws(() => control.checkHost(file, () => {}), /journal is a symlink/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('disconnect containment is project-scoped and disables restarts before stopping', () => {
  const { dir, file } = fixture();
  const calls: string[][] = [];
  try {
    const count = control.stopProject(file, (args: string[]) => {
      calls.push(args);
      return args[0] === 'ps' ? 'fixture-a\nfixture-b\n' : '';
    });
    assert.equal(count, 2);
    assert.deepEqual(calls[0], ['ps', '-aq', '--filter', 'label=com.docker.compose.project=fixture']);
    assert.deepEqual(calls.slice(1), [
      ['update', '--restart=no', 'fixture-a'],
      ['update', '--restart=no', 'fixture-b'],
      ['stop', '--time', '30', 'fixture-a', 'fixture-b']
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guarded Compose disables daemon restarts and carries proof policy into controller and worker', () => {
  const { dir, file } = fixture();
  try {
    const config = control.composeOverride(file, path.join(root, 'stackarr/docker-compose.yml'));
    assert.ok(Object.keys(config.services).length > 20);
    for (const service of Object.values(config.services) as { restart: string }[]) assert.equal(service.restart, 'no');
    for (const name of ['app', 'app-updater']) {
      assert.equal(config.services[name].environment.STACKARR_STORAGE_POLICY, file);
      assert.equal(config.services[name].volumes[0].read_only, true);
      assert.equal(config.services[name].volumes[0].bind.create_host_path, false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('monitor launchers quote paths and reject external or Homebrew runtime dependencies', () => {
  const plist = render(
    'darwin',
    '/usr/local/bin/node',
    '/Users/test/App Support/storage.cjs',
    '/Users/test/state/storage-policy.json',
    '/Users/test/logs'
  );
  assert.match(plist, /com.stackarr.storage/);
  assert.match(plist, /KeepAlive/);
  assert.throws(
    () => render('darwin', '/opt/homebrew/bin/node', '/internal/storage.cjs', '/internal/policy', '/internal/logs'),
    /internal/
  );
  assert.throws(
    () => render('darwin', '/usr/bin/node', '/Volumes/Disk/storage.cjs', '/internal/policy', '/internal/logs'),
    /internal/
  );
  assert.match(
    render('linux', '/usr/bin/node', '/home/test/a b/storage.cjs', '/home/test/state/policy', '/home/test/logs'),
    /"\/home\/test\/a b\/storage.cjs"/
  );
});

test('internal-only CLI status does not enroll or create storage state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-storage-cli-'));
  try {
    const out = execFileSync('bash', [path.join(root, 'stackarr/bin/stackarr'), 'storage', 'status'], {
      env: { ...process.env, APP_ROOT_DEFAULT_OVERRIDE: dir, STACKARR_STORAGE_POLICY: '' },
      encoding: 'utf8'
    });
    assert.match(out, /not enabled/);
    assert.throws(() => readFileSync(path.join(dir, 'state/storage-policy.json')), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guard ordering covers bootstrap DB reads, generated Compose and backup publication', () => {
  const common = readFileSync(path.join(root, 'stackarr/lib/common.sh'), 'utf8');
  const load = common.slice(common.indexOf('load_env() {'));
  assert.ok(load.indexOf('stackarr_storage_guard') < load.indexOf('load_sqlite_runtime_config'));
  const backup = readFileSync(path.join(root, 'stackarr/scripts/backup-run.sh'), 'utf8');
  assert.match(backup, /stackarr_storage_guard\nprogress 97/);
});
