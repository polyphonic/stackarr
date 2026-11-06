import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readHostCapacityReport } from '../../core/src/hostCapacityReport';

const require = createRequire(import.meta.url);
const capacityPath = require.resolve('../../../stackarr/scripts/storage-capacity.cjs');
const capacity = require(capacityPath);
const scratch = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'capacity-regression-'));

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
      for (let i = 0; i < 30; i++) {
        names = fs.readdirSync(bridge).filter((v) => v.endsWith('.request'));
        if (names.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(names.length, 1);
      const request = JSON.parse(fs.readFileSync(path.join(bridge, names[0]), 'utf8'));
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
