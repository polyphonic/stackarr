import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('private SQLite CLI and real MCP transport draft parity', () => {
  const root = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'dt-'));
  try {
    const child = spawnSync(
      path.join(repo, 'packages/integration-tests/node_modules/.bin/tsx'),
      ['--test', 'packages/integration-tests/fixtures/instance-transports.fixture.ts'],
      {
        cwd: repo,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          PATH: process.env.PATH || '/usr/bin:/bin',
          HOME: root,
          TMPDIR: root,
          STACKARR_REPO_ROOT: root,
          STACKARR_DATA_DIR: root,
          STACKARR_DATABASE_FILE: path.join(root, 'draft.db'),
          STACKARR_DATABASE_MODE: 'sqlite',
          DOCKER_HOST: `unix://${root}/absent.sock`,
          DOCKER_CONFIG: path.join(root, 'docker-empty'),
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
        }
      }
    );
    assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /fail 0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
