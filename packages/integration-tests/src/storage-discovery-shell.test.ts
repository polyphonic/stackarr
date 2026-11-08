import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const scriptsRoot = path.resolve(import.meta.dirname, '../../../stackarr/scripts');

test('host shell uses read-only authoritative record and never retained ambient paths or lifecycle helpers', () => {
  const fixture = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'storage-export-'));
  try {
    const scripts = path.join(fixture, 'scripts');
    mkdirSync(scripts);
    mkdirSync(path.join(fixture, 'lib'));
    for (const name of ['storage-capacity-discovery.sh', 'storage-config-read.cjs'])
      copyFileSync(path.join(scriptsRoot, name), path.join(scripts, name));
    const state = path.join(fixture, 'state');
    mkdirSync(state);
    const policy = path.join(state, 'storage-policy.json');
    writeFileSync(policy, '{}');
    writeFileSync(
      path.join(fixture, 'lib/common.sh'),
      `
fail() { printf 'rejected\\n' >&2; exit 1; }
load_compose_runtime_env() { :; }
configure_docker_environment() { :; }
default_stackarr_database_file() { printf '%s\\n' "$FIXTURE_DB"; }
load_env() { exit 95; }
stackarr_compose() { exit 96; }
`
    );
    writeFileSync(
      path.join(scripts, 'storage-discovery.cjs'),
      `const fs=require('fs'); const v=JSON.parse(fs.readFileSync(0)); if(process.env.STACKARR_CAPACITY_POLICY!==v.STATE_ROOT+'/storage-policy.json') process.exit(1); console.log(JSON.stringify({log:v.LOG_ROOT??null}));`
    );
    const fakebin = path.join(fixture, 'bin');
    mkdirSync(fakebin);
    const dockerLog = path.join(fixture, 'docker.log');
    writeFileSync(
      path.join(fakebin, 'docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = ps ]; then
  case "$*" in
    *'label=com.docker.compose.project=stackarr'*'label=com.docker.compose.service=stackarr'*) [ "\${CONTROLLER_SERVICE:-stackarr}" = stackarr ] && printf '%s' "\${CONTROLLER_IDS:-}" || :;;
    *'label=com.docker.compose.project=stackarr'*'label=com.docker.compose.service=app'*) [ "\${CONTROLLER_SERVICE:-stackarr}" = app ] && printf '%s' "\${CONTROLLER_IDS:-}"; printf '%s' "\${CONTROLLER_IDS_OLD:-}";;
    *) :;;
  esac
elif [ "$1" = exec ] && [ "$2" = -i ] && [ "$3" = abcdef123456 ] && [ "$4" = node ] && [ "$5" = - ] && [ "$6" = --capacity-discovery ]; then
  printf '%s' "$CONTROLLER_RECORD"
else exit 3; fi
`,
      { mode: 0o755 }
    );
    const dbPath = path.join(fixture, 'stackarr.db');
    const env = {
      ...process.env,
      FIXTURE_DB: dbPath,
      CONFIG_ROOT: fixture,
      LOG_ROOT: '/unrelated-sd',
      STACKARR_DATABASE_MODE: 'sqlite',
      STACKARR_DATABASE_URL: '',
      STACKARR_RUNTIME: '',
      DOCKER_LOG: dockerLog,
      CONTROLLER_RECORD: JSON.stringify({ STATE_ROOT: state, LOG_ROOT: 'controller' }),
      PATH: `${fakebin}:${process.env.PATH}`
    };
    const run = (p: string, changes = {}) =>
      spawnSync('bash', [path.join(scripts, 'storage-capacity-discovery.sh'), p], {
        env: { ...env, ...changes },
        encoding: 'utf8'
      });
    assert.notEqual(run(policy).status, 0);
    const db = new DatabaseSync(dbPath);
    db.exec('create table app_settings (key text primary key,value text)');
    db.prepare('insert into app_settings values (?,?)').run(
      'stackarr.runtimeConfig',
      JSON.stringify({ APP_ROOT: fixture, CONFIG_ROOT: fixture, STATE_ROOT: state })
    );
    db.close();
    const before = readFileSync(dbPath);
    assert.deepEqual(JSON.parse(run(policy).stdout), { log: null });
    assert.deepEqual(JSON.parse(run(policy, { CONTROLLER_IDS: 'abcdef123456' }).stdout), { log: 'controller' });
    assert.deepEqual(JSON.parse(run(policy, { CONTROLLER_IDS: 'abcdef123456', CONTROLLER_SERVICE: 'app' }).stdout), {
      log: 'controller'
    });
    assert.notEqual(run(policy, { CONTROLLER_IDS: 'abcdef123456', CONTROLLER_IDS_OLD: 'abcdef654321' }).status, 0);
    assert.match(readFileSync(dockerLog, 'utf8'), /exec -i abcdef123456 node - --capacity-discovery/);
    assert.notEqual(run(policy, { CONTROLLER_IDS: 'abcdef123456\\nabcdef654321' }).status, 0);
    assert.notEqual(run(policy, { CONTROLLER_IDS: 'abcdef123456', CONTROLLER_RECORD: 'not-json' }).status, 0);
    assert.notEqual(
      run(policy, { CONTROLLER_IDS: 'abcdef123456', CONTROLLER_RECORD: JSON.stringify({ STATE_ROOT: '/wrong' }) })
        .status,
      0
    );
    assert.deepEqual(
      JSON.parse(run(policy, { STACKARR_CAPACITY_PROJECT: 'wrong-project', CONTROLLER_IDS: 'abcdef123456' }).stdout),
      { log: null }
    );
    assert.notEqual(run(policy, { STACKARR_DATABASE_MODE: 'postgres' }).status, 0);
    assert.deepEqual(
      JSON.parse(run(policy, { STACKARR_DATABASE_MODE: 'postgres', CONTROLLER_IDS: 'abcdef123456' }).stdout),
      { log: 'controller' }
    );
    assert.notEqual(run(path.join(fixture, 'wrong-policy.json')).status, 0);
    assert.notEqual(run(policy, { STACKARR_RUNTIME: 'docker' }).status, 0);
    assert.notEqual(run(policy, { STACKARR_DATABASE_MODE: 'postgres' }).status, 0);
    assert.deepEqual(readFileSync(dbPath), before);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
