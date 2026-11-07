import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repo = path.resolve(import.meta.dirname, '../../..');
test('installed host launcher preserves stdin through fake Docker preflight and uses exact controller', () => {
  const root = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'instance-launcher-'));
  try {
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const fake = path.join(bin, 'docker');
    writeFileSync(
      fake,
      '#!/bin/bash\nset -eu\nif [[ "${1:-}" == info || "${1:-}" == context ]]; then cat >/dev/null; exit 0; fi\nprintf "%s\\n" "$@" > "$FAKE_DOCKER_ARGS"\ncat > "$FAKE_DOCKER_STDIN"\n'
    );
    chmodSync(fake, 0o755);
    const argsFile = path.join(root, 'args');
    const stdinFile = path.join(root, 'stdin');
    const payload = '{"definitionId":"sonarr","displayName":"Host","ownership":"managed"}\n';
    const result = spawnSync('/bin/bash', [path.join(repo, 'stackarr/bin/stackarr'), 'instances', 'create'], {
      cwd: repo,
      input: payload,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        PATH: `${bin}:${process.env.PATH || '/usr/bin:/bin'}`,
        HOME: root,
        TMPDIR: root,
        STACKARR_REPO_ROOT: repo,
        APP_ROOT: root,
        CONFIG_ROOT: path.join(root, 'config'),
        STACKARR_DATABASE_FILE: path.join(root, 'draft.db'),
        STACKARR_DATABASE_MODE: 'sqlite',
        DOCKER_HOST: `unix://${root}/fake.sock`,
        FAKE_DOCKER_ARGS: argsFile,
        FAKE_DOCKER_STDIN: stdinFile
      }
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readFileSync(argsFile, 'utf8').trim().split('\n'), [
      'exec',
      '-i',
      'stackarr',
      'node',
      'packages/mcp/dist/index.js',
      'instances',
      'create'
    ]);
    assert.equal(readFileSync(stdinFile, 'utf8'), payload);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
