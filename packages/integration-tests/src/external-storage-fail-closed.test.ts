import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const control = require('../../../stackarr/scripts/storage-control.cjs');
const script = fileURLToPath(new URL('../../../stackarr/scripts/storage-control.cjs', import.meta.url));
const stackRoot = fileURLToPath(new URL('../../../stackarr', import.meta.url));
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-enrollment-'));
  fs.mkdirSync(path.join(dir, 'state'));
  const file = path.join(dir, 'state/storage-policy.json');
  return { dir, file, marker: path.join(dir, 'state/storage-enrollment.json') };
}
function guarded(dir: string) {
  return spawnSync('bash', ['-c', 'source "$ROOT_DIR/lib/common.sh"; stackarr_storage_guard'], {
    env: { ...process.env, ROOT_DIR: stackRoot, APP_ROOT_DEFAULT_OVERRIDE: dir, STACKARR_STORAGE_POLICY: '' },
    encoding: 'utf8'
  });
}

test('partial Docker preparation remains explicitly incomplete and cannot enable unguarded startup', () => {
  const f = fixture();
  try {
    const run = (args: string[]) => {
      if (args[0] === 'ps') return 'fixture-a\nfixture-b\n';
      if (args.at(-1) === 'fixture-b') throw new Error('injected daemon failure');
      return '';
    };
    assert.throws(() => control.prepare(f.file, 'fixture', run, () => {}), /injected/);
    assert.equal(fs.existsSync(f.file), false);
    assert.equal(JSON.parse(fs.readFileSync(f.marker, 'utf8')).phase, 'preparing');
    assert.notEqual(guarded(f.dir).status, 0);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('enrollment commits only after restart read-back; missing policy still allows scoped containment', () => {
  const f = fixture();
  try {
    let verified = false;
    control.prepare(
      f.file,
      'fixture',
      (args: string[]) => {
        assert.equal(fs.existsSync(f.file), false, 'policy must not commit before Docker verification');
        if (args[0] === 'ps') return 'fixture-a\n';
        if (args[0] === 'inspect') {
          verified = true;
          return 'no\n';
        }
        return '';
      },
      () => {}
    );
    assert.ok(verified);
    assert.equal(JSON.parse(fs.readFileSync(f.marker, 'utf8')).phase, 'ready');
    fs.unlinkSync(f.file);
    assert.notEqual(guarded(f.dir).status, 0);
    const calls: string[][] = [];
    control.stopProject(f.file, (args: string[]) => {
      calls.push(args);
      return args[0] === 'ps' ? 'fixture-a\n' : '';
    });
    assert.ok(calls[0].includes('label=com.docker.compose.project=fixture'));
    assert.deepEqual(calls.at(-1), ['stop', '--time', '30', 'fixture-a']);
    assert.throws(
      () =>
        control.prepare(
          f.file,
          'fixture',
          () => '',
          () => {}
        ),
      /missing policy/
    );
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('host CLI rejects a healthy policy when no live monitor answers', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file, JSON.stringify({ version: 1, project: 'fixture', roots: [] }));
    fs.mkdirSync(control.bridgeDir(f.file));
    assert.throws(
      () => execFileSync(process.execPath, [script, 'host-check', f.file], { timeout: 22000, stdio: 'pipe' }),
      (error: any) => error.status === 1 && error.signal === null
    );
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('running monitor retains exact containment scope after its policy disappears', async () => {
  const f = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    fs.writeFileSync(f.file, JSON.stringify({ version: 1, project: 'fixture', roots: [] }));
    fs.mkdirSync(control.bridgeDir(f.file));
    const docker = path.join(f.dir, 'fake-docker');
    const log = path.join(f.dir, 'calls');
    fs.writeFileSync(
      docker,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIXTURE_LOG"\nif [ "$1" = ps ]; then printf "fixture-a\\n"; fi\n',
      { mode: 0o700 }
    );
    child = spawn(process.execPath, [script, 'watch', f.file], {
      env: { ...process.env, STACKARR_STORAGE_DOCKER: docker, FIXTURE_LOG: log },
      stdio: 'ignore'
    });
    await control.checkGuest(f.file, { timeout: 5000 });
    fs.unlinkSync(f.file);
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !(fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('stop --time 30 fixture-a'))
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /label=com.docker.compose.project=fixture/);
    assert.match(calls, /stop --time 30 fixture-a/);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
