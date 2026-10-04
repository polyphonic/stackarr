import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const source = new URL('../../../stackarr/scripts/scheduler.sh', import.meta.url);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-scheduler-lock-'));
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'lib'));
  await mkdir(path.join(root, 'bin'));
  const script = path.join(root, 'scripts/scheduler.sh');
  await writeFile(script, await readFile(source, 'utf8'));
  await writeFile(
    path.join(root, 'lib/common.sh'),
    `
STATE_ROOT="$ROOT_DIR/state"
STACKARR_DATABASE_FILE="$ROOT_DIR/tasks.db"
ensure_dir() { mkdir -p "$1"; }
lowercase() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
flag_enabled() { [[ "$1" == true ]]; }
load_env() { ENABLE_BACKUP=true; BACKUP_SCHEDULE=daily; BACKUP_TIME=00:00; ENABLE_SCHEDULED_UPDATES=false; QUESTARR_ROMM_IMPORT_ENABLED=false; TIMEZONE=Etc/UTC; return 0; }
`
  );
  const bin = path.join(root, 'bin/stackarr');
  await writeFile(
    bin,
    '#!/bin/bash\nprintf "start\\n" >> "$ROOT_DIR/jobs"\nsleep 1\nprintf "end\\n" >> "$ROOT_DIR/jobs"\n'
  );
  await chmod(bin, 0o755);
  return { root, script };
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, ...args], { env });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, code }));
  });
}

test('legacy empty lock and simultaneous schedulers run one job per stamp', async () => {
  const { root, script } = await fixture();
  const env = { ...process.env, ROOT_DIR: root };
  const lock = path.join(root, 'state/scheduler/backup.lock');
  try {
    await mkdir(lock, { recursive: true });
    const [first, second] = await Promise.all([run(script, ['--run-once'], env), run(script, ['--run-once'], env)]);
    assert.equal(first.code, 0, first.stdout);
    assert.equal(second.code, 0, second.stdout);
    assert.equal(await readFile(path.join(root, 'jobs'), 'utf8'), 'start\nend\n');
    assert.match(first.stdout + second.stdout, /already running/);
    const third = await run(script, ['--run-once'], env);
    assert.equal(third.code, 0, third.stdout);
    assert.equal(await readFile(path.join(root, 'jobs'), 'utf8'), 'start\nend\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scheduled update persists output before the job exits', async () => {
  const { root, script } = await fixture();
  const nodeBin = path.join(root, 'bin/node');
  const gate = path.join(root, 'gate');
  const log = path.join(root, 'task-output');
  await writeFile(
    nodeBin,
    '#!/bin/bash\ncase "$2" in\n  create) printf "task-1\\n" ;;\n  append) printf "%s" "$4" >> "$ROOT_DIR/task-output" ;;\n  update) : ;;\nesac\n'
  );
  await chmod(nodeBin, 0o755);
  await writeFile(
    path.join(root, 'bin/stackarr'),
    '#!/bin/bash\nprintf "first line\\n"\nwhile [[ ! -f "$ROOT_DIR/gate" ]]; do sleep 0.05; done\nprintf "last line\\n"\n'
  );
  const env = { ...process.env, ROOT_DIR: root, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` };
  const child = spawn('bash', [script, '--locked-job', 'update', 'test-stamp'], { env });
  let output = '';
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  try {
    let seen = false;
    for (let i = 0; i < 100; i++) {
      try {
        seen = (await readFile(log, 'utf8')).includes('first line');
      } catch {
        /* waiting for first append */
      }
      if (seen) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(seen, `first line was not persisted while update was running: ${output}`);
    assert.equal(child.exitCode, null);
    await writeFile(gate, 'continue');
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0, output);
    assert.equal(await readFile(log, 'utf8'), 'first line\nlast line\n');
  } finally {
    await writeFile(gate, 'continue');
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
