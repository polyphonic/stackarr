import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readHostCapacityReport, validateCapacityReport } from '../../core/src/hostCapacityReport';
import { configuredDiskUsages } from '../../core/src/metrics';
import { collectServiceStorage } from '../../core/src/serviceStorage';

const require = createRequire(import.meta.url);
const capacity = require('../../../stackarr/scripts/storage-capacity.cjs');
const scratch = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'auto-capacity-'));

test('configured backup/log/library/app roots auto-pin without observation or lifecycle protection', () => {
  const dir = scratch();
  try {
    const policy = path.join(dir, 'storage-policy.json');
    const text = JSON.stringify({ version: 1, roots: [] });
    fs.writeFileSync(policy, text);
    const roots = ['backup', 'logs', 'library', 'app'].map((v) => path.join(dir, v));
    roots.forEach((v) => fs.mkdirSync(v));
    const associated = collectServiceStorage({
      env: { BACKUP_ROOT: roots[0], LOG_ROOT: roots[1], ENABLE_BACKUP: 'false' },
      services: [
        { name: 'plex', mode: 'native' },
        { name: 'youtarr', mode: 'docker', dockerService: 'youtarr' }
      ],
      libraries: [{ service: 'plex', path: roots[2], reason: 'Library location' }],
      containers: [
        {
          Config: { Labels: { 'com.docker.compose.project': 'stackarr', 'com.docker.compose.service': 'youtarr' } },
          Mounts: [{ Type: 'bind', Source: roots[3], Destination: '/data' }]
        }
      ],
      project: 'stackarr'
    });
    let current = associated;
    const run = () => capacity.report(policy, { discover: () => ({ roots: current, issues: [] }) });
    const result = run();
    assert.equal(result.entries.length, 4);
    assert(result.entries.every((v: any) => v.status === 'available'));
    assert(validateCapacityReport(result));
    assert.equal(fs.readFileSync(policy, 'utf8'), text);
    const ledger = path.join(dir, 'storage-capacity-identities.json');
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(ledger, 'utf8')).records).length, 4);
    const unrelated = path.join(dir, 'unrelated-sd');
    fs.mkdirSync(unrelated);
    assert(!Object.hasOwn(JSON.parse(fs.readFileSync(ledger, 'utf8')).records, unrelated));
    current = associated.filter((v) => v.path !== roots[0]);
    assert(!run().entries.some((v: any) => v.path === roots[0]));
    current = associated;
    const pins = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    pins.records[roots[0]].uuid = 'previous-volume';
    fs.writeFileSync(ledger, JSON.stringify(pins));
    assert.equal(run().entries.find((v: any) => v.path === roots[0]).status, 'stale-identity');
    fs.rmdirSync(roots[1]);
    assert.equal(run().entries.find((v: any) => v.path === roots[1]).status, 'missing');
    assert.equal(fs.readFileSync(policy, 'utf8'), text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('batch validation rejects duplicate, missing, injected, malformed and false-positive capacity', () => {
  const root = { path: '/configured', service: 'backup', reason: 'Backup', source: 'configuration' };
  const data = { roots: [root], issues: [], entries: [{ path: '/configured', status: 'missing', usage: null }] };
  assert(validateCapacityReport(data));
  assert(!validateCapacityReport({ ...data, entries: [] }));
  assert(!validateCapacityReport({ ...data, entries: [...data.entries, ...data.entries] }));
  assert(!validateCapacityReport({ ...data, entries: [{ path: '/unrelated-sd', status: 'missing', usage: null }] }));
  assert(!validateCapacityReport({ ...data, entries: [{ ...data.entries[0], status: 'available' }] }));
});

test('normal host exporter/responder/report handles unenrolled roots, native API and future config changes without blocking the client', {
  timeout: 30000
}, async () => {
  const home = scratch();
  const saved = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    STACKARR_STORAGE_POLICY: process.env.STACKARR_STORAGE_POLICY
  };
  const app =
    process.platform === 'darwin'
      ? path.join(home, 'Library/Application Support/Stackarr')
      : path.join(home, '.stackarr');
  const state = path.join(home, 'separate-state');
  const config = path.join(app, 'config');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  const file = path.join(state, 'storage-policy.json');
  const policyText = JSON.stringify({ version: 1, roots: [], project: 'capacity-fixture' });
  fs.writeFileSync(file, policyText);
  fs.mkdirSync(path.join(state, 'storage-bridge'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  const dirs = ['backup', 'logs', 'media-library', 'plex-config', 'app-data'].map((n) => path.join(home, n));
  dirs.forEach((v) => fs.mkdirSync(v));
  const inspected = JSON.stringify({
    Config: { Labels: { 'com.docker.compose.project': 'capacity-fixture', 'com.docker.compose.service': 'youtarr' } },
    State: { Running: true },
    Mounts: [{ Type: 'bind', Source: dirs[4], Destination: '/data' }]
  });
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh\ncase "$1" in\nps) case "$*" in *label=com.docker.compose.service=stackarr*) exit 0;; *label=com.docker.compose.service=app*) exit 0;; *label=com.docker.compose.project=capacity-fixture*) printf 'abcdef123456\\n';; *) exit 9;; esac;;\ninspect) printf '%s\\n' '${inspected}';;\nesac\n`,
    { mode: 0o755 }
  );
  fs.mkdirSync(path.join(state, 'compose'));
  fs.writeFileSync(
    path.join(state, 'compose/.env'),
    `APP_ROOT=${JSON.stringify(app)}\nCONFIG_ROOT=${JSON.stringify(config)}\nSTATE_ROOT=${JSON.stringify(state)}\nSTACKARR_DATABASE_MODE=sqlite\n`
  );
  const server = createServer((req, res) => {
    if (req.url !== '/library/sections' || req.headers['x-plex-token'] !== 'fixture-token') {
      res.writeHead(401);
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ MediaContainer: { Directory: [{ Location: [{ path: dirs[2] }] }] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const db = new DatabaseSync(path.join(config, 'stackarr.db'));
  db.exec('create table app_settings (key text primary key, value text)');
  const env: Record<string, string> = {
    APP_ROOT: app,
    STATE_ROOT: state,
    CONFIG_ROOT: config,
    LOG_ROOT: dirs[1],
    BACKUP_ROOT: dirs[0],
    ENABLE_BACKUP: 'false',
    ENABLE_YOUTARR: 'true',
    STACKARR_PG_BACKUP_ENABLED: 'false',
    PLEX_INSTALL_MODE: 'native',
    JELLYFIN_INSTALL_MODE: 'disabled',
    PLEX_CONFIG_PATH: dirs[3],
    PLEX_TOKEN: 'fixture-token',
    PLEX_URL: `http://127.0.0.1:${port}`
  };
  const save = () =>
    db.prepare('insert or replace into app_settings values (?, ?)').run('stackarr.runtimeConfig', JSON.stringify(env));
  save();
  process.env.HOME = home;
  process.env.PATH = `${bin}:${saved.PATH}`;
  process.env.STACKARR_STORAGE_POLICY = file;
  const sourceRoot = path.resolve(import.meta.dirname, '../../../stackarr');
  const installedBin = execFileSync(
    '/bin/bash',
    ['-c', 'source "$1/lib/common.sh"; install_managed_host_runtime', 'bash', sourceRoot],
    {
      env: { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
      encoding: 'utf8',
      timeout: 15000
    }
  ).trim();
  assert(installedBin.startsWith(`${home}/`));
  const installedScripts = path.resolve(path.dirname(installedBin), '../scripts');
  assert.deepEqual(
    fs.readFileSync(path.join(installedScripts, 'storage-discovery.cjs')),
    fs.readFileSync(path.join(sourceRoot, 'scripts/storage-discovery.cjs'))
  );
  const installedControl = require(path.join(installedScripts, 'storage-control.cjs'));
  let ticks = 0;
  const tick = setInterval(() => ticks++, 10);
  const responder = setInterval(() => installedControl.respond(file), 50);
  try {
    const start = performance.now();
    const rows = await configuredDiskUsages(env);
    assert(performance.now() - start < 8000);
    assert(ticks > 5, 'client event loop must remain live while host probes');
    for (const requested of dirs)
      assert(
        rows.some((row) => row.associations?.some((a) => a.path === requested && a.status === 'available')),
        requested
      );
    assert.equal(fs.readFileSync(file, 'utf8'), policyText);
    const next = path.join(home, 'new-backup');
    fs.mkdirSync(next);
    env.BACKUP_ROOT = next;
    delete env.LOG_ROOT;
    save();
    const changed = await readHostCapacityReport(file);
    assert(changed?.entries.some((e) => e.path === next && e.status === 'available'));
    assert(!changed?.entries.some((e) => e.path === dirs[0] || e.path === dirs[1]));
    assert.equal(env.ENABLE_BACKUP, 'false');
    assert.equal(env.STACKARR_PG_BACKUP_ENABLED, 'false');
  } finally {
    clearInterval(tick);
    clearInterval(responder);
    db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('absent responder has a bounded asynchronous deadline and no cached proof', async () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'storage-policy.json');
    fs.writeFileSync(file, '{}');
    fs.mkdirSync(path.join(dir, 'storage-bridge'));
    let ticked = false;
    setTimeout(() => {
      ticked = true;
    }, 10);
    assert.equal(await readHostCapacityReport(file, 100), null);
    assert(ticked);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'storage-bridge')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
