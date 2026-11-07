import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const source = new URL('../../../stackarr/scripts/postgres-backup.sh', import.meta.url);
const pythonSource = new URL('../../../stackarr/scripts/postgres-backup.py', import.meta.url);

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'stackarr-pg-shell-')));
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
if sys.argv[1:] == ['guard-staging']:
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'steps'), 'a') as steps:
        steps.write('guard\\n')
    sys.exit(0)
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
    for (const extra of [
      { TEST_POSTGRES: 'true' },
      { TEST_POSTGRES: 'false', STACKARR_DATABASE_URL: 'postgresql://fixture:synthetic@source.invalid/runtime' }
    ]) {
      await writeFile(path.join(root, 'steps'), '');
      const result = await run(script, ['run'], { ...process.env, ...extra });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /authoritative/);
      assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\n');
    }
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
    assert.equal(
      await readFile(path.join(root, 'steps'), 'utf8'),
      'load\nlock\nguard\nmount\ndocker\nload\nlock\nguard\nmount\n'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('manual no-prune reaches the native runner and invalid uses fail before loading settings', async () => {
  const { root, script } = await fixture();
  try {
    const result = await run(script, ['run', '--no-prune'], {
      ...process.env,
      POSTGRES_DEPLOYMENT_MODE: 'independent'
    });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(JSON.parse(result.output).args, ['run', '--no-prune']);
    assert.equal(JSON.parse(result.output).container, null);
    assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\nlock\nguard\nmount\n');
    for (const args of [
      ['test', '--no-prune'],
      ['run-due', '--no-prune'],
      ['run', '--no-prune', '--extra']
    ]) {
      await writeFile(path.join(root, 'steps'), '');
      const invalid = await run(script, args, { ...process.env });
      assert.notEqual(invalid.code, 0);
      assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), '');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('retained generation listing and selected export work without the source database', async () => {
  const { root, script } = await fixture();
  try {
    const output = path.join(root, 'selected-generation');
    const generation = '12345678-1234-4234-8234-123456789abc';
    for (const args of [
      ['list'],
      ['export', '--output', output, '--generation', generation],
      ['export', '--output', output, '--previous']
    ]) {
      await writeFile(path.join(root, 'steps'), '');
      const result = await run(script, args, { ...process.env, TEST_POSTGRES: 'true' });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(JSON.parse(result.output).args, args);
      assert.equal(JSON.parse(result.output).container, null);
      assert.equal(
        await readFile(path.join(root, 'steps'), 'utf8'),
        args[0] === 'list' ? 'load\nlock\n' : 'load\nlock\nguard\nmount\n'
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generation CLI rejects malformed selectors and extra arguments before loading settings', async () => {
  const { root, script } = await fixture();
  try {
    for (const args of [
      ['list', '--previous'],
      ['export', '--output', '/fixture', '--generation'],
      ['export', '--output', '/fixture', '--generation', 'not-a-uuid'],
      ['export', '--output', '/fixture', '--generation', '12345678-1234-4234-8234-123456789abc', '--previous'],
      ['export', '--output', '/fixture', '--unknown']
    ]) {
      const result = await run(script, args, { ...process.env });
      assert.notEqual(result.code, 0);
      await assert.rejects(readFile(path.join(root, 'steps')), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unknown source mode fails before mount or Docker discovery', async () => {
  const { root, script } = await fixture();
  try {
    for (const operation of ['test', 'run']) {
      await writeFile(path.join(root, 'steps'), '');
      const result = await run(script, [operation], { ...process.env, POSTGRES_DEPLOYMENT_MODE: 'unsupported' });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /Unsupported PostgreSQL deployment mode/);
      assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\n');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed source discovers Docker after mount; external source never discovers Docker', async () => {
  const { root, script } = await fixture();
  try {
    for (const mode of ['managed', 'external']) {
      for (const operation of ['test', 'run']) {
        await writeFile(path.join(root, 'steps'), '');
        const result = await run(script, [operation], { ...process.env, POSTGRES_DEPLOYMENT_MODE: mode });
        assert.equal(result.code, 0, result.output);
        assert.equal(JSON.parse(result.output).container, mode === 'managed' ? 'aabbccdd' : null);
        assert.equal(
          await readFile(path.join(root, 'steps'), 'utf8'),
          mode === 'managed' && operation === 'test'
            ? 'load\nlock\ndocker\n'
            : `load\nlock\nguard\nmount\n${mode === 'managed' ? 'docker\n' : ''}`
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing external capabilities fail in real Python before any DB or Docker use', async () => {
  const { root, script } = await fixture();
  try {
    await writeFile(path.join(root, 'scripts/postgres-backup.py'), await readFile(pythonSource, 'utf8'));
    for (const operation of ['test', 'run']) {
      for (const missing of [
        'HOST',
        'PORT',
        'INSTANCE_ID',
        'CLIENT_BIN',
        'CLIENT_MAJOR',
        'USER',
        'PASSWORD',
        'TLS_MODE',
        'TLS_ROOT_CERT'
      ]) {
        await writeFile(path.join(root, 'steps'), '');
        const result = await run(script, [operation], {
          ...process.env,
          POSTGRES_DEPLOYMENT_MODE: 'external',
          STATE_ROOT: root,
          BACKUP_ROOT: root,
          STACKARR_PG_BACKUP_SOURCE_HOST: 'source.example.test',
          STACKARR_PG_BACKUP_SOURCE_PORT: '5432',
          STACKARR_PG_BACKUP_SOURCE_INSTANCE_ID: '7640492719126172372',
          STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN: '/fixture',
          STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR: '18',
          STACKARR_PG_BACKUP_SOURCE_USER: 'backup_owner',
          STACKARR_PG_BACKUP_SOURCE_PASSWORD: 'private',
          STACKARR_PG_BACKUP_SOURCE_TLS_MODE: 'verify-full',
          STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT: '/fixture/ca.pem',
          [`STACKARR_PG_BACKUP_SOURCE_${missing}`]: ''
        });
        assert.notEqual(result.code, 0, `${operation} missing ${missing}: ${result.output}`);
        assert.match(result.output, /External PostgreSQL source capabilities are incomplete/);
        assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\nlock\nmount\n');
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('independent source verifies mounts and skips Docker discovery', async () => {
  const { root, script } = await fixture();
  try {
    for (const operation of ['test', 'run']) {
      await writeFile(path.join(root, 'steps'), '');
      const result = await run(script, [operation], {
        ...process.env,
        POSTGRES_DEPLOYMENT_MODE: 'independent',
        POSTGRES_HOST_ADDRESS: '127.0.0.1',
        POSTGRES_HOST_PORT: '5434',
        POSTGRES_INSTANCE_ID: '7640492719126172372',
        POSTGRES_HOST_CLIENT_BIN: '/fixture/bin',
        DATABASE_SUPERUSER: 'postgres',
        DATABASE_SUPERUSER_PASSWORD: 'private'
      });
      assert.equal(result.code, 0, result.output);
      assert.equal(JSON.parse(result.output).container, null);
      assert.equal(await readFile(path.join(root, 'steps'), 'utf8'), 'load\nlock\nguard\nmount\n');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
