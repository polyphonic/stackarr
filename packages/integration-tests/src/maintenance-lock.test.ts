import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const lock = new URL('../../../stackarr/scripts/maintenance-lock.py', import.meta.url).pathname;
const common = new URL('../../../stackarr/lib/common.sh', import.meta.url).pathname;

function run(args: string[], env = process.env): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [lock, ...args], { env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function waitFor(file: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.fail(`timed out waiting for ${file}`);
}

test('shared maintenance lock excludes contenders and retains the same kernel descriptor in child', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-maintenance-'));
  const gate = path.join(root, 'gate');
  const started = path.join(root, 'started');
  const child = spawn('python3', [
    lock,
    root,
    '--',
    'python3',
    '-c',
    'import os,time,sys; open(sys.argv[1],"w").write(str(os.fstat(int(os.environ["STACKARR_MAINTENANCE_LOCK_FD"])).st_ino));\nwhile not os.path.exists(sys.argv[2]): time.sleep(.02)',
    started,
    gate
  ]);
  try {
    await waitFor(started);
    const busy = await run([root, '--', 'python3', '-c', 'print("should-not-run")']);
    assert.equal(busy.code, 75);
    assert.doesNotMatch(busy.output, /should-not-run/);
    await writeFile(gate, 'go');
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    const free = await run([root, '--', 'python3', '-c', 'print("ran")']);
    assert.equal(free.code, 0);
    assert.match(free.output, /ran/);
  } finally {
    await writeFile(gate, 'go');
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test('shell nesting validates an inherited descriptor rather than trusting a forged variable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-maintenance-'));
  const script = path.join(root, 'nested.sh');
  await writeFile(
    script,
    `#!/bin/bash\nsource ${JSON.stringify(common)}\nSTATE_ROOT="$1"\nmaintenance_lock_owned && echo owned\n`
  );
  try {
    const owned = await run([root, '--', 'bash', script, root]);
    assert.equal(owned.code, 0, owned.output);
    assert.match(owned.output, /owned/);
    const forged = await new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn('bash', [script, root], { env: { ...process.env, STACKARR_MAINTENANCE_LOCK_FD: '9' } });
      let output = '';
      child.stdout.on('data', (chunk) => (output += String(chunk)));
      child.stderr.on('data', (chunk) => (output += String(chunk)));
      child.on('close', (code) => resolve({ code, output }));
    });
    assert.equal(forged.code, 1);
    assert.doesNotMatch(forged.output, /owned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inherited lock survives supervisor termination until child exits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-maintenance-'));
  const gate = path.join(root, 'gate');
  const started = path.join(root, 'started');
  const supervisor = spawn('python3', [
    lock,
    root,
    '--',
    'python3',
    '-c',
    'import os,time,sys; open(sys.argv[1],"w").write("ready");\nwhile not os.path.exists(sys.argv[2]): time.sleep(.02)',
    started,
    gate
  ]);
  try {
    await waitFor(started);
    supervisor.kill('SIGKILL');
    await new Promise((resolve) => supervisor.on('exit', resolve));
    const busy = await run([root, '--', 'python3', '-c', 'print("should-not-run")']);
    assert.equal(busy.code, 75);
    await writeFile(gate, 'go');
    // The orphan finishes and releases the inherited descriptor.
    let free;
    for (let i = 0; i < 100; i++) {
      free = await run([root, '--', 'python3', '-c', 'print("ran")']);
      if (free.code === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(free?.code, 0);
  } finally {
    await writeFile(gate, 'go');
    if (supervisor.exitCode === null) supervisor.kill();
    await rm(root, { recursive: true, force: true });
  }
});
