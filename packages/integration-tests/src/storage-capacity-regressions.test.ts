import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readHostCapacityReport, validateCapacityReport } from '../../core/src/hostCapacityReport';

const require = createRequire(import.meta.url);
const capacityPath = require.resolve('../../../stackarr/scripts/storage-capacity.cjs');
const capacity = require(capacityPath);
const scratch = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'capacity-regression-'));

test('missing child gets only a stable, independently inspected enclosing mount, never capacity', () => {
  const dir = scratch();
  try {
    const policyFile = path.join(dir, 'storage-policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({ version: 1, roots: [] }));
    const missing = path.join(dir, 'future', 'media');
    const link = path.join(dir, 'dangling');
    fs.symlinkSync(path.join(dir, 'absent'), link);
    const rows = capacity.snapshot([missing, link, path.join(link, 'child')]);
    const enclosing = rows.get(missing).enclosingMount;
    assert.equal(rows.get(missing).status, 'missing');
    assert.equal(rows.get(missing).usage, null);
    assert.equal(
      enclosing?.realAnchor,
      require('../../../stackarr/scripts/storage-policy.cjs').captureRoot(dir).realPath
    );
    assert.equal(rows.get(link).enclosingMount, undefined, 'dangling symlink is not a missing leaf');
    assert.equal(rows.get(path.join(link, 'child')).enclosingMount, undefined, 'dangling ancestor cannot lend a mount');
    const discovered = () => ({
      roots: [{ path: missing, service: 'romm', reason: 'Library', source: 'configuration' }],
      issues: []
    });
    const report = capacity.report(policyFile, { discover: discovered });
    assert.equal(report.entries[0].status, 'missing');
    assert.equal(report.entries[0].usage, null);
    assert.deepEqual(report.entries[0].enclosingMount, enclosing);
    assert(validateCapacityReport(report), JSON.stringify(report));
    let observations = 0;
    const changed = capacity.report(policyFile, {
      discover: discovered,
      snapshot: () =>
        new Map([
          [
            missing,
            {
              status: 'missing',
              usage: null,
              enclosingMount: observations++ ? { ...enclosing, volumeId: 'replacement' } : enclosing
            }
          ]
        ])
    });
    assert.equal(changed.entries[0].status, 'missing');
    assert.equal(changed.entries[0].usage, null);
    assert.equal(changed.entries[0].enclosingMount, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('previously available path retains its mount association after becoming missing', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'storage-policy.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, roots: [] }));
    const target = path.join(dir, 'library');
    fs.mkdirSync(target);
    const discover = () => ({
      roots: [{ path: target, service: 'romm', reason: 'Library', source: 'configuration' }],
      issues: []
    });
    assert.equal(capacity.report(file, { discover }).entries[0].status, 'available');
    fs.rmdirSync(target);
    const entry = capacity.report(file, { discover }).entries[0];
    assert.equal(entry.status, 'missing');
    assert.equal(entry.usage, null);
    assert(entry.enclosingMount, 'filesystem type and df device must not be compared as the same identifier');
    assert(validateCapacityReport({ ...discover(), entries: [entry] }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing symlink descendant uses its physical mount and still rejects an absent external mount', () => {
  const cp = require('node:child_process');
  const policy = require('../../../stackarr/scripts/storage-policy.cjs');
  const original = {
    run: cp.execFileSync,
    inspect: policy.inspectVolume,
    real: fs.realpathSync,
    stat: fs.statSync,
    exists: fs.existsSync,
    lstat: fs.lstatSync
  };
  try {
    for (const namespace of ['/mnt', '/media', '/Volumes']) {
      for (const mounted of [true, false]) {
        const anchor = `${namespace}/alias`,
          target = `${anchor}/future`,
          physical = mounted ? `${namespace}/drive` : namespace;
        cp.execFileSync = () =>
          `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fixture 1000 500 500 50% ${mounted ? physical : '/'}\n`;
        fs.realpathSync = ((value: string) => {
          if (value === target) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          return value === anchor ? physical : value;
        }) as typeof fs.realpathSync;
        fs.existsSync = ((value: string) => value !== target) as typeof fs.existsSync;
        fs.lstatSync = (() => undefined) as unknown as typeof fs.lstatSync;
        fs.statSync = (() => ({ dev: 2, ino: 3, isDirectory: () => true })) as unknown as typeof fs.statSync;
        policy.inspectVolume = () => ({ mountPoint: physical, uuid: 'fixture', filesystem: 'ext4', readOnly: false });
        delete require.cache[capacityPath];
        const entry = require(capacityPath).snapshot([target]).get(target);
        assert.equal(entry.status, 'missing');
        assert.equal(entry.usage, null);
        assert.equal(Boolean(entry.enclosingMount), mounted, namespace);
        if (mounted) assert.equal(entry.enclosingMount.realAnchor, physical);
      }
    }
  } finally {
    cp.execFileSync = original.run;
    policy.inspectVolume = original.inspect;
    fs.realpathSync = original.real;
    fs.statSync = original.stat;
    fs.existsSync = original.exists;
    fs.lstatSync = original.lstat;
    delete require.cache[capacityPath];
  }
});

test('missing path proof cannot bridge a changed mount, nested device, or unmounted namespace', () => {
  const root = { path: '/mnt/a/missing', service: 'romm', reason: 'Library', source: 'configuration' };
  const entry = {
    path: root.path,
    status: 'missing',
    usage: null,
    enclosingMount: {
      filesystem: '/dev/a',
      filesystemType: 'ext4',
      mountPoint: '/mnt/a',
      volumeId: 'uuid',
      realAnchor: '/mnt/a',
      anchor: '/mnt/a'
    }
  };
  assert(validateCapacityReport({ roots: [root], issues: [], entries: [entry] }));
  assert(!validateCapacityReport({ roots: [root], issues: [], entries: [{ ...entry, status: 'unmounted' }] }));
  assert(
    !validateCapacityReport({
      roots: [root],
      issues: [],
      entries: [{ ...entry, enclosingMount: { ...entry.enclosingMount, mountPoint: '/mnt/b' } }]
    })
  );
  const child = require('node:child_process');
  const original = { run: child.execFileSync, realpath: fs.realpathSync, stat: fs.statSync };
  try {
    child.execFileSync = () =>
      'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/parent 1000 500 500 50% /\n';
    fs.realpathSync = ((v: string) => v) as typeof fs.realpathSync;
    fs.statSync = (() => ({ dev: 1, ino: 2 })) as unknown as typeof fs.statSync;
    delete require.cache[capacityPath];
    assert.equal(
      require(capacityPath).snapshot(['/mnt/offline/leaf']).get('/mnt/offline/leaf').enclosingMount,
      undefined
    );
  } finally {
    child.execFileSync = original.run;
    fs.realpathSync = original.realpath;
    fs.statSync = original.stat;
    delete require.cache[capacityPath];
  }
});

test('first encounter of disconnected Linux mount namespace fails before UUID inspection (simulated kernel boundary)', () => {
  const child = require('node:child_process');
  const original = { run: child.execFileSync, realpath: fs.realpathSync, stat: fs.statSync };
  try {
    child.execFileSync = () =>
      'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/parent 1000 500 500 50% /\n';
    fs.realpathSync = ((v: string) => v) as typeof fs.realpathSync;
    fs.statSync = (() => ({ dev: 1, ino: 2 })) as unknown as typeof fs.statSync;
    delete require.cache[capacityPath];
    const fixture = require(capacityPath);
    for (const target of ['/mnt/offline/backup', '/media/user/offline/library']) {
      const result = fixture.snapshot([target]).get(target);
      assert.equal(result.status, 'unmounted');
      assert.equal(result.usage, null);
    }
  } finally {
    child.execFileSync = original.run;
    fs.realpathSync = original.realpath;
    fs.statSync = original.stat;
    delete require.cache[capacityPath];
  }
});

test('authority changes during a report reject all results and do not commit first identity pins', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'storage-policy.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, roots: [] }));
    let reads = 0;
    assert.throws(
      () =>
        capacity.report(file, {
          discover: () => ({
            roots: ++reads === 1 ? [{ path: dir, service: 'backup', reason: 'Backup', source: 'configuration' }] : [],
            issues: []
          })
        }),
      /Authority changed/
    );
    assert(!fs.existsSync(path.join(dir, 'storage-capacity-identities.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retargeted configured symlink and permission failures retain null capacity and original pins', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'storage-policy.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, roots: [] }));
    const a = path.join(dir, 'a'),
      b = path.join(dir, 'b'),
      link = path.join(dir, 'logical');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.symlinkSync(a, link);
    const discover = () => ({
      roots: [{ path: link, service: 'backup', reason: 'Backup', source: 'configuration' }],
      issues: []
    });
    assert.equal(capacity.report(file, { discover }).entries[0].status, 'available');
    const ledger = path.join(dir, 'storage-capacity-identities.json'),
      before = fs.readFileSync(ledger, 'utf8');
    fs.unlinkSync(link);
    fs.symlinkSync(b, link);
    assert.equal(capacity.report(file, { discover }).entries[0].status, 'stale-identity');
    const denied = capacity.report(file, {
      discover,
      snapshot: () => new Map([[link, { status: 'permission-denied', usage: null }]])
    });
    assert.equal(denied.entries[0].status, 'permission-denied');
    assert.equal(denied.entries[0].usage, null);
    assert.equal(fs.readFileSync(ledger, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const mutation of ['nonce', 'digest', 'stale', 'future', 'policy-change', 'injected-path', 'duplicate']) {
  test(`asynchronous report denies ${mutation} proof`, async () => {
    const dir = scratch();
    try {
      const file = path.join(dir, 'storage-policy.json');
      fs.writeFileSync(file, '{}');
      const bridge = path.join(dir, 'storage-bridge');
      fs.mkdirSync(bridge);
      const result = readHostCapacityReport(file, 1000);
      let names: string[] = [];
      let request: { nonce: string; digest: string; at: number } | undefined;
      for (let i = 0; i < 30; i++) {
        names = fs.readdirSync(bridge).filter((v) => v.endsWith('.request'));
        if (names.length === 1) {
          try {
            request = JSON.parse(fs.readFileSync(path.join(bridge, names[0]), 'utf8'));
            break;
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            // The producer creates the request before filling its JSON payload.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(names.length, 1);
      assert.ok(request, 'request payload must become readable before the deadline');
      const reply: any = {
        nonce: request.nonce,
        digest: request.digest,
        at: Date.now(),
        ready: true,
        roots: [{ path: '/configured', service: 'backup', reason: 'Backup', source: 'configuration' }],
        issues: [],
        entries: [{ path: '/configured', status: 'missing', usage: null }]
      };
      if (mutation === 'nonce') reply.nonce = '0'.repeat(32);
      if (mutation === 'digest') reply.digest = '0'.repeat(64);
      if (mutation === 'stale') reply.at = request.at - 1;
      if (mutation === 'future') reply.at += 100000;
      if (mutation === 'policy-change') fs.writeFileSync(file, '{"changed":true}');
      if (mutation === 'injected-path') reply.entries[0].path = '/unrelated-sd';
      if (mutation === 'duplicate') reply.entries.push(reply.entries[0]);
      fs.writeFileSync(path.join(bridge, names[0].replace('.request', '.response')), JSON.stringify(reply));
      assert.equal(await result, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
