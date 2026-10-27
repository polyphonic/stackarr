import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const source = new URL('../../../stackarr/scripts/postgres-backup.sh', import.meta.url);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-pg-shell-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'lib'));
  const script = path.join(root, 'scripts/postgres-backup.sh');
  await writeFile(script, await readFile(source, 'utf8'));
  await chmod(script, 0o755);
  await writeFile(
    path.join(root, 'lib/common.sh'),
    `
fail() { printf '%s\\n' "$*" >&2; exit 1; }
load_compose_runtime_env() { printf 'compose\\n' >> "$ROOT_DIR/steps"; }
load_env() { printf 'load\\n' >> "$ROOT_DIR/steps"; STACKARR_PG_BACKUP_ENABLED="\${TEST_ENABLED:-false}"; export STACKARR_PG_BACKUP_ENABLED; }
database_mode_is_postgres() { [[ "\${TEST_POSTGRES:-false}" == true ]]; }
load_postgres_runtime_config() { return 1; }
flag_enabled() { [[ "$1" == true ]]; }
maintenance_lock_enter() { printf 'lock\\n' >> "$ROOT_DIR/steps"; }
verify_backup_mounts() { printf 'mount\\n' >> "$ROOT_DIR/steps"; }
ensure_docker_runtime() { printf 'docker\\n' >> "$ROOT_DIR/steps"; }
stackarr_compose() { printf '%s\\n' aabbccdd; }
default_app_root() { printf '%s\\n' "$ROOT_DIR/app"; }
`
  );
  await writeFile(
    path.join(root, 'scripts/postgres-backup.py'),
    `import json,os,sys
print(json.dumps({'args':sys.argv[1:],'container':os.environ.get('STACKARR_PG_BACKUP_SOURCE_CONTAINER'),'state':os.environ.get('STATE_ROOT')}))
`
  );
  return { root, script };
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, ...args], { env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('status loads current settings but never discovers a source or connects to the target', async () => {
  const { root, script } = await fixture();
  try {
    const result = await run(script, ['status'], { ...process.env, STATE_ROOT: path.join(root, 'state') });
    assert.equal(result.code, 0, result.output);
    assert.equal(JSON.parse(result.output).state, path.join(root, 'state'));
    assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('disabled run-due never acquires maintenance or contacts either database', async () => {
  const { root, script } = await fixture();
  try {
    const result = await run(script, ['run-due'], { ...process.env, TEST_ENABLED: 'false' });
    assert.equal(result.code, 0, result.output);
    assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed authoritative host settings stop before any backup or target action', async () => {
  const { root, script } = await fixture();
  try {
    const result = await run(script, ['run'], { ...process.env, TEST_POSTGRES: 'true' });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /authoritative/);
    assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('run verifies mounts before source discovery, export works without a source', async () => {
  const { root, script } = await fixture();
  try {
    const output = path.join(root, 'snapshot.dump');
    for (const args of [['run'], ['export', '--output', output]]) {
      const result = await run(script, args, { ...process.env, TEST_ENABLED: 'true' });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(JSON.parse(result.output).args, args);
      assert.equal(JSON.parse(result.output).container, args[0] === 'run' ? 'aabbccdd' : null);
    }
    assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\nlock\nmount\ndocker\nload\nlock\nmount\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
