import assert from 'node:assert/strict';
import { execFile as callback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(callback);
const repo = fileURLToPath(new URL('../../../', import.meta.url));

async function run(
  sequence: string[],
  options: { partial?: boolean; missing?: boolean; multi?: boolean; healthyStability?: number } = {}
) {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-update-readiness-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'lib'));
    await mkdir(path.join(root, 'bin'));
    await writeFile(
      path.join(root, 'scripts/update-run.sh'),
      await readFile(path.join(repo, 'stackarr/scripts/update-run.sh'))
    );
    for (const name of ['naming.sh', 'downloads.sh', 'requests.sh']) {
      const file = path.join(root, 'scripts', name);
      await writeFile(file, `#!/bin/bash\nprintf '%s\\n' '${name} '$* >> "$ACTIONS"\n`);
      await chmod(file, 0o755);
    }
    await writeFile(
      path.join(root, 'lib/common.sh'),
      `
print_header() { :; }
load_env() { :; }
maintenance_lock_enter() { :; }
database_mode_is_postgres() { return 1; }
write_compose_env_file() { :; }
wait_for_stackarr_storage() { :; }
ensure_docker_runtime() { :; }
compose_profile_args() { printf '%s\\n' --profile stackarr; }
stackarr_compose() {
  printf '%s\\n' "$*" >> "$ACTIONS"
  case "$*" in
    *'config --services') printf 'app\\nfirst\\nsecond\\n';;
    *'pull --quiet first') return 0;;
    *'pull --quiet second') return ${options.partial ? 1 : 0};;
    *'pull --quiet'*) return ${options.partial ? 1 : 0};;
    *'ps --all -q first') ${options.missing ? ':' : options.multi ? "printf 'abcdef\\n123456\\n'" : "printf 'abcdef\\n'"};;
    *'ps --all -q second') printf '123456\\n';;
  esac
  return 0
}
remove_database_init_sidecar() { :; }
remove_inactive_torrent_client_container() { :; }
warn() { :; }
ok() { :; }
fail() { printf '%s\\n' "$1" >&2; exit 1; }
`
    );
    const docker = path.join(root, 'bin/docker');
    await writeFile(
      docker,
      `#!/bin/bash
printf '%s\\n' "$*" >> "$ACTIONS"
[[ "$1" == inspect ]] || exit 8
if [[ "$4" == 123456 ]]; then printf 'running|healthy|0|configured\\n'; exit; fi
index=$(cat "$INDEX")
IFS=',' read -r -a states <<< "$STATES"
if (( index >= \${#states[@]} )); then index=$((\${#states[@]} - 1)); fi
printf '%s\\n' "\${states[index]}"
printf '%s\\n' "$((index + 1))" > "$INDEX"
`
    );
    await chmod(docker, 0o755);
    const index = path.join(root, 'index');
    const actions = path.join(root, 'actions');
    await writeFile(index, '0');
    const result = await execFile('bash', [path.join(root, 'scripts/update-run.sh'), 'services'], {
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        ACTIONS: actions,
        INDEX: index,
        STATES: sequence.join(','),
        STACKARR_UPDATE_PULL_ATTEMPTS: '1',
        STACKARR_UPDATE_READY_TIMEOUT_SECONDS: '6',
        STACKARR_UPDATE_HEALTHY_STABILITY_SECONDS: String(options.healthyStability ?? 0),
        STACKARR_UPDATE_RUNNING_STABILITY_SECONDS: '1'
      }
    }).then(
      ({ stdout, stderr }) => ({ success: true, stdout, stderr }),
      (e: Error & { stdout: string; stderr: string }) => ({ success: false, stdout: e.stdout, stderr: e.stderr })
    );
    return { ...result, actions: await readFile(actions, 'utf8') };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('cleanup follows checked healthy services; partial pull still checks selected service and fails overall', async () => {
  const full = await run(['running|healthy|0|configured']);
  assert.equal(full.success, true, full.stderr);

  assert.ok(full.actions.indexOf('downloads.sh apply') < full.actions.indexOf('inspect --format'));
  assert.ok(full.actions.indexOf('requests.sh apply') < full.actions.indexOf('inspect --format'));
  assert.ok(full.actions.indexOf('inspect --format') < full.actions.indexOf('run --rm image-cleanup'));
  const partial = await run(['running|healthy|0|configured'], { partial: true });
  assert.equal(partial.success, false);
  assert.match(partial.stderr, /partially updated/);
  assert.match(partial.actions, /run --rm image-cleanup/);
  assert.doesNotMatch(partial.actions, /up -d --no-deps first second/);
});

test('unhealthy, exited, restarting, malformed or missing containers skip cleanup', async () => {
  for (const state of [
    'running|unhealthy|0|configured',
    'exited|none|0|none',
    'restarting|starting|1|configured',
    'running|none|0|configured',
    'running|healthy|bad|configured'
  ]) {
    const result = await run([state]);
    assert.equal(result.success, false, state);
    assert.doesNotMatch(result.actions, /run --rm image-cleanup/, state);
  }
  for (const options of [{ missing: true }, { multi: true }]) {
    const result = await run(['running|healthy|0|configured'], options);
    assert.equal(result.success, false);
    assert.doesNotMatch(result.actions, /run --rm image-cleanup/);
  }
});

test('starting check times out; checked health must stay healthy; unchecked running needs stability and restart changes fail', async () => {
  const transient = await run(['running|healthy|0|configured', 'running|unhealthy|0|configured'], {
    healthyStability: 1
  });
  assert.equal(transient.success, false);
  assert.match(transient.stderr, /unhealthy/);
  assert.doesNotMatch(transient.actions, /run --rm image-cleanup/);
  const delayed = await run(
    ['running|starting|0|configured', 'running|healthy|0|configured', 'running|healthy|0|configured'],
    { healthyStability: 1 }
  );
  assert.equal(delayed.success, true, delayed.stderr);
  assert.match(delayed.actions, /run --rm image-cleanup/);
  const starting = await run(['running|starting|0|configured']);
  assert.equal(starting.success, false);
  assert.match(starting.stderr, /timed out/);
  assert.doesNotMatch(starting.actions, /run --rm image-cleanup/);
  const unchecked = await run(['running|none|0|none']);
  assert.equal(unchecked.success, true, unchecked.stderr);
  assert.match(unchecked.actions, /run --rm image-cleanup/);
  const restart = await run(['running|none|0|none', 'running|none|1|none']);
  assert.equal(restart.success, false);
  assert.match(restart.stderr, /restarted/);
  assert.doesNotMatch(restart.actions, /run --rm image-cleanup/);
});
