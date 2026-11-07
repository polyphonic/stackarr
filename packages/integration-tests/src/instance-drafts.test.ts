import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('isolated frontend draft route and persistence contract', () => {
  // Keep the tsx IPC socket below the Unix-domain path limit.
  const root = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'd-'));
  try {
    const child = spawnSync(
      path.join(repo, 'packages/integration-tests/node_modules/.bin/tsx'),
      ['--test', 'apps/frontend/tests/instance-drafts.fixture.ts'],
      {
        cwd: repo,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          PATH: process.env.PATH || '/usr/bin:/bin',
          HOME: root,
          TMPDIR: root,
          STACKARR_TEST_ROOT: root,
          STACKARR_REPO_ROOT: root,
          STACKARR_DATA_DIR: root,
          DOCKER_HOST: `unix://${root}/absent-docker.sock`,
          DOCKER_CONFIG: path.join(root, 'docker-empty'),
          STACKARR_DATABASE_FILE: path.join(root, 'draft.db'),
          STACKARR_DATABASE_MODE: 'sqlite',
          STACKARR_API_KEY: 'test-key',
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
        }
      }
    );
    assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /fail 0/);
  } finally {
    // The database owner is a terminated child, so SQLite handles are closed.
    rmSync(root, { recursive: true, force: true });
  }
});

test('already-versioned beta rows survive atomic upgrade and rollback', () => {
  const root = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'd-'));
  const dbFile = path.join(root, 'beta.db');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec(`create table schema_migrations(version integer primary key);
      insert into schema_migrations values(20260920);
      create table app_instances (
        id text primary key, definition_id text not null, display_name text not null,
        ownership text not null check (ownership in ('managed','external','native')),
        configuration text not null default '{}', secret_references text not null default '{}',
        created_at text not null default (datetime('now')), updated_at text not null default (datetime('now')));
      insert into app_instances values('beta-id','sonarr','Original','managed','{"quality":"uhd"}',
        '{"token":"private-ref"}','2026-01-02','2026-03-04');
      create trigger deny_upgrade before insert on schema_migrations
        when new.version = 20261107 begin select raise(abort, 'injected failure'); end;`);
    const run = () =>
      spawnSync(
        path.join(repo, 'packages/integration-tests/node_modules/.bin/tsx'),
        [
          '-e',
          "import {readInstanceRowsPage} from './packages/core/src/database.ts'; console.log(JSON.stringify(readInstanceRowsPage(2)))"
        ],
        {
          cwd: repo,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH || '/usr/bin:/bin',
            HOME: root,
            TMPDIR: root,
            STACKARR_DATA_DIR: root,
            STACKARR_REPO_ROOT: root,
            DOCKER_HOST: `unix://${root}/absent-docker.sock`,
            DOCKER_CONFIG: path.join(root, 'docker-empty'),
            STACKARR_DATABASE_FILE: dbFile,
            STACKARR_DATABASE_MODE: 'sqlite',
            NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
          }
        }
      );
    const failed = run();
    assert.notEqual(failed.status, 0, failed.stdout);
    assert.equal(
      (db.prepare('select count(*) as n from schema_migrations where version=20261107').get() as { n: number }).n,
      0
    );
    assert.equal(
      (
        db.prepare("select count(*) as n from pragma_table_info('app_instances') where name='state'").get() as {
          n: number;
        }
      ).n,
      0
    );
    db.exec('drop trigger deny_upgrade');
    const upgraded = run();
    assert.equal(upgraded.status, 0, upgraded.stderr);
    const rows = JSON.parse(upgraded.stdout.trim());
    assert.deepEqual(rows, [
      {
        id: 'beta-id',
        definition_id: 'sonarr',
        display_name: 'Original',
        ownership: 'managed',
        configuration: '{"quality":"uhd"}',
        secret_references: '{"token":"private-ref"}',
        created_at: '2026-01-02',
        updated_at: '2026-03-04',
        state: 'draft'
      }
    ]);
    assert.equal(
      (db.prepare('select count(*) as n from schema_migrations where version=20261107').get() as { n: number }).n,
      1
    );
    assert.throws(() => db.exec("update app_instances set state='active'"), /constraint/i);
    assert.equal(run().status, 0, 'repeat migration must be reentrant');
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
