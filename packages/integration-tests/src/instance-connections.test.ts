import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('draft connection public actions persist against isolated SQLite', () => {
  const root = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'c-'));
  try {
    const child = spawnSync(
      path.join(repo, 'packages/integration-tests/node_modules/.bin/tsx'),
      ['--test', 'packages/integration-tests/src/instance-connections.fixture.ts'],
      {
        cwd: repo,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          PATH: process.env.PATH || '/usr/bin:/bin',
          HOME: root,
          TMPDIR: root,
          STACKARR_DATA_DIR: root,
          STACKARR_REPO_ROOT: root,
          DOCKER_HOST: `unix://${root}/absent-docker.sock`,
          DOCKER_CONFIG: path.join(root, 'docker-empty'),
          STACKARR_DATABASE_FILE: path.join(root, 'connections.db'),
          STACKARR_DATABASE_MODE: 'sqlite',
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
        }
      }
    );
    assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /fail 0/);
    for (const line of child.stdout
      .split('\n')
      .filter((line) => line.includes('concurrent ') && line.includes('outcomes:')))
      console.log(line);
    const db = new DatabaseSync(path.join(root, 'connections.db'));
    try {
      db.exec('pragma foreign_keys = on');
      assert.equal(
        (db.prepare('select version from schema_migrations where version = 20261108').get() as { version: number })
          .version,
        20261108
      );
      assert.ok(
        [10, 11].includes((db.prepare('select count(*) as n from app_instance_connections').get() as { n: number }).n)
      );
      assert.throws(
        () => db.exec("insert into app_instance_connections values ('missing','missing-2','download-client')"),
        /constraint/i
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
