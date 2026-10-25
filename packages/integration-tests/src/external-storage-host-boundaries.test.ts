import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const installer = require('../../../stackarr/scripts/storage-monitor-install.cjs');
const move = require('../../../stackarr/scripts/storage-move.cjs');

test('monitor keeps docker invocation name and includes its directory in launch PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-cli-fixture-'));
  const previous = process.env.PATH;
  try {
    const binary = path.join(root, 'multi-call');
    const alias = path.join(root, 'docker');
    fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.symlinkSync(binary, alias);
    process.env.PATH = root;
    assert.equal(installer.dockerExecutable(), alias);
    const rendered = installer.render(
      'darwin',
      '/usr/local/bin/node',
      '/opt/app/control.cjs',
      '/opt/app/policy.json',
      '/opt/app/logs',
      alias
    );
    assert.ok(rendered.includes(`/usr/local/bin:${root}:/usr/local/bin`));
  } finally {
    process.env.PATH = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('host waits for exclusive API publication to release its temporary hard link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-request-fixture-'));
  try {
    const policy = path.join(root, 'storage-policy.json');
    const dir = move.directory(policy);
    fs.mkdirSync(dir);
    const temporary = path.join(dir, 'temporary');
    const incoming = path.join(dir, 'request.json');
    fs.writeFileSync(temporary, '{}');
    fs.linkSync(temporary, incoming);
    assert.equal(move.consume(policy, { guard: () => assert.fail('guard'), spawn: () => assert.fail('spawn') }), false);
    assert.equal(fs.existsSync(incoming), true);
    assert.equal(fs.existsSync(path.join(dir, 'status.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native writer check scans writable handles only after container shutdown', () => {
  const calls: string[] = [];
  const run = (file: string) => {
    calls.push(file);
    if (file === '/bin/ps') return '';
    throw Object.assign(new Error('lsof result'), { status: 1, stdout: 'p123\nf7\nau\n', stderr: '' });
  };
  move.nativeWriters('/fixture/config', run, 'preflight');
  assert.deepEqual(calls, ['/bin/ps']);
  assert.throws(() => move.nativeWriters('/fixture/config', run, 'stopped'), /Native writer/);
  move.nativeWriters('/fixture/config', (file: string) => (file === '/bin/ps' ? '' : 'p123\nf7\nar\n'), 'stopped');
});
