#!/usr/bin/env node
'use strict';
// Explicit opt-in native Docker fixture. Reuses a local image and never pulls it.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const image = process.env.STACKARR_TEST_CONTROLLER_IMAGE;
assert.ok(image, 'Set STACKARR_TEST_CONTROLLER_IMAGE to an existing local Stackarr image');
const helper = path.resolve(__dirname, '../../../stackarr/scripts/controller-upgrade.cjs');
function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
}
function inventory() {
  const ids = docker(['ps', '-aq']).trim().split(/\s+/).filter(Boolean);
  return Object.fromEntries(
    (ids.length ? JSON.parse(docker(['inspect', ...ids])) : []).map((c) => [
      c.Id,
      {
        started: c.State.StartedAt,
        restarts: c.RestartCount,
        image: c.Image,
        mounts: c.Mounts
      }
    ])
  );
}
docker(['image', 'inspect', image]);
const before = inventory();
for (const fail of [false, true]) {
  const project = `controller-fixture-${randomBytes(6).toString('hex')}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'controller-upgrade-'));
  const file = path.join(dir, 'compose.json');
  const compose = ['compose', '--project-name', project, '--project-directory', dir, '-f', file];
  const config = { services: {}, volumes: { config: {}, state: {} } };
  const service = (name, command, port) => ({
    image,
    pull_policy: 'never',
    entrypoint: ['node'],
    command: ['-e', command],
    environment: { STACKARR_RUNTIME: 'docker', STACKARR_CONTAINER_NAME: name, STACKARR_WEB_PORT: '7777' },
    labels: { 'org.opencontainers.image.title': 'Stackarr', 'com.stackarr.test.ephemeral': 'controller-upgrade' },
    volumes: ['config:/stackarr-config', 'state:/stackarr-state'],
    ports: port ? [`127.0.0.1:${port}:7777`] : [],
    restart: 'no',
    mem_limit: '128m'
  });
  const server = "require('node:http').createServer((q,r)=>{r.end('[]')}).listen(7777,'0.0.0.0')";
  config.services.app = service('app', server, '0');
  config.services.witness = service('witness', 'setInterval(()=>{},1000)', null);
  const save = () => writeFileSync(file, JSON.stringify(config));
  try {
    save();
    docker([...compose, 'up', '-d', '--no-deps', 'app', 'witness']);
    const oldId = docker([...compose, 'ps', '-q', 'app']).trim();
    const witnessId = docker([...compose, 'ps', '-q', 'witness']).trim();
    const old = JSON.parse(docker(['inspect', oldId]))[0];
    const port = old.NetworkSettings.Ports['7777/tcp'][0].HostPort;
    const witness = JSON.parse(docker(['inspect', witnessId]))[0];
    docker([
      'exec',
      oldId,
      'node',
      '-e',
      "require('fs').writeFileSync('/stackarr-config/preserved','original');require('fs').writeFileSync('/stackarr-state/preserved','state')"
    ]);
    delete config.services.app;
    config.services.stackarr = service('stackarr', fail ? 'process.exit(3)' : server, port);
    save();
    const result = spawnSync(
      process.execPath,
      [helper, project, 'docker', ...compose, 'up', '-d', '--no-deps', '--force-recreate', 'stackarr'],
      { encoding: 'utf8', timeout: 180000 }
    );
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    const restored = JSON.parse(docker(['inspect', witnessId]))[0];
    assert.equal(restored.State.StartedAt, witness.State.StartedAt);
    assert.equal(restored.RestartCount, witness.RestartCount);
    let active;
    if (fail) {
      assert.match(result.stderr, /original controller and restart policy restored/);
      active = JSON.parse(docker(['inspect', oldId]))[0];
      assert.equal(active.State.Running, true);
      assert.deepEqual(active.HostConfig.RestartPolicy, old.HostConfig.RestartPolicy);
      assert.equal(docker([...compose, 'ps', '--all', '-q', 'stackarr']).trim(), '');
    } else {
      assert.equal(docker(['ps', '-aq', '--filter', `id=${oldId}`]).trim(), '');
      const newId = docker([...compose, 'ps', '-q', 'stackarr']).trim();
      active = JSON.parse(docker(['inspect', newId]))[0];
    }
    docker([
      'exec',
      active.Id,
      'node',
      '-e',
      "const a=require('assert/strict'),f=require('fs');a.equal(f.readFileSync('/stackarr-config/preserved','utf8'),'original');a.equal(f.readFileSync('/stackarr-state/preserved','utf8'),'state')"
    ]);
    console.log(
      fail
        ? 'PASS: real failed replacement restores legacy controller and data'
        : 'PASS: real legacy port handover, health and data preservation'
    );
  } finally {
    docker([...compose, 'down', '--remove-orphans', '--volumes']);
    assert.equal(docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).trim(), '');
    assert.equal(docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).trim(), '');
    rmSync(dir, { recursive: true, force: true });
  }
}
assert.deepEqual(inventory(), before, 'unrelated live containers must stay exactly unchanged');
console.log('PASS: fixture cleanup and unrelated live container identity preservation');
