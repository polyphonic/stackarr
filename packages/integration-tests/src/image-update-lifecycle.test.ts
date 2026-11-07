import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const root = path.join(repo, 'stackarr');

test('legacy volume migration refuses a direct Docker run when helper identity is unavailable', async () => {
  const script = `source '${root}/lib/common.sh'
  docker() { if [[ "$1" == inspect ]]; then printf 'volume|legacy-volume\\n'; else echo "unexpected Docker action: $*" >&2; exit 22; fi; }
  migrate_legacy_image_volume legacy /config new-volume`;
  await assert.rejects(execFile('bash', ['-c', script]), /Automatic legacy volume migration HOLD/);
});

test('common Compose lifecycle preserves install, recovery, configuration apply and read-only commands without release enrollment', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'stackarr-image-lifecycle-'));
  try {
    const bin = path.join(fixture, 'bin');
    await mkdir(bin);
    await writeFile(path.join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_ACTIONS"\n');
    await chmod(path.join(bin, 'docker'), 0o755);
    const script = `source '${root}/lib/common.sh'
configure_docker_environment() { :; }
prepare_compose_runtime_file() { :; }
stackarr_storage_guard() { printf 'guard\\n' >> "$TEST_ACTIONS"; }
stackarr_verify_legacy_compose_mounts() { :; }
migrate_legacy_image_volumes() { :; }
stackarr_compose_project_dir() { printf '%s\\n' "$TEST_PROJECT"; }
stackarr_compose_file() { printf '%s\\n' "$TEST_PROJECT/compose.yml"; }
stackarr_compose "$@"`;
    const actions = path.join(fixture, 'actions');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ACTIONS: actions, TEST_PROJECT: fixture };
    const run = (...args: string[]) => execFile('bash', ['-c', script, 'lifecycle-test', ...args], { env });
    await run('ps', '--all');
    await run('up', '-d', 'app');
    await run('create', 'app');
    await run('run', '--rm', 'app', 'echo');
    await run('pull', 'app');
    await run('stop', 'app');
    const log = await readFile(actions, 'utf8');
    assert.match(log, /guard/);
    assert.match(log, /up -d app/);
    assert.match(log, /create app/);
    assert.match(log, /run --rm app echo/);
    assert.match(log, /pull app/);
    assert.doesNotMatch(log, /config --format json|ps --all -q/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
