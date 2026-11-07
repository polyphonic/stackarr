import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const control = require('../../../stackarr/scripts/storage-control.cjs');
const { internalPaths } = require('../../../stackarr/scripts/storage-monitor-install.cjs');
const compose = fileURLToPath(new URL('../../../stackarr/docker-compose.yml', import.meta.url));

test('real Compose merge forbids bind-path creation and daemon restart for every service', (t) => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'pipe' });
  } catch {
    t.skip('Docker Compose CLI unavailable. This test does not use a daemon.');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-compose-storage-'));
  try {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME, // Docker discovers its Compose plugin here; no daemon is used.
      APP_ROOT: `${dir}/app $dollar`,
      CONFIG_ROOT: `${dir}/config $dollar`,
      STATE_ROOT: `${dir}/state`,
      LOG_ROOT: `${dir}/logs`,
      USERNAME: 'fixture',
      PASSWORD: 'fixture-only'
    };
    const envFile = path.join(dir, 'empty.env');
    fs.writeFileSync(envFile, '');
    const args = ['compose', '--project-directory', dir, '--env-file', envFile, '-p', 'storage-fixture', '-f', compose];
    const read = (extra: string[]) =>
      JSON.parse(
        execFileSync('docker', [...args, ...extra, '--profile', '*', 'config', '--format', 'json'], {
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
    const base = read([]);
    const policy = path.join(dir, 'state/storage-policy.json');
    fs.mkdirSync(path.dirname(policy));
    fs.writeFileSync(policy, JSON.stringify({ version: 1, project: 'storage-fixture', roots: [] }));
    const override = path.join(dir, 'override.json');
    const text = JSON.stringify(control.composeOverride(policy, compose, base));
    assert.ok(!text.includes('fixture-only'), 'rendered environment must never be persisted');
    fs.writeFileSync(override, text);
    const cliText = execFileSync(
      process.execPath,
      [path.join(path.dirname(compose), 'scripts/storage-control.cjs'), 'override', policy, compose, dir],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    assert.deepEqual(JSON.parse(cliText), JSON.parse(text), 'CLI uses the same portable Compose render path');
    assert.ok(!cliText.includes('fixture-only'), 'CLI must omit rendered credentials');
    const merged = read(['-f', override]);
    assert.deepEqual(Object.keys(merged.services), Object.keys(base.services));
    for (const [name, service] of Object.entries(merged.services) as [string, any][]) {
      assert.equal(service.restart, 'no', name);
      for (const mount of service.volumes || [])
        if (mount.type === 'bind') assert.equal(mount.bind.create_host_path, false, `${name}: ${mount.target}`);
      for (const original of base.services[name].volumes || []) {
        const after = service.volumes.find((v: any) => v.target === original.target);
        assert.equal(after.source, original.source, `${name}: source preserved including dollar signs`);
        assert.equal(after.read_only, original.read_only);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recovery removes project containers without volumes or database reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-recovery-'));
  try {
    const policy = path.join(dir, 'storage-policy.json');
    fs.writeFileSync(policy, JSON.stringify({ version: 1, project: 'isolated', roots: [] }));
    const calls: string[][] = [];
    control.removeProject(policy, (args: string[]) => {
      calls.push(args);
      return args[0] === 'ps' ? 'fixture-id\n' : '';
    });
    assert.deepEqual(calls.at(-1), ['rm', 'fixture-id']);
    assert.ok(
      calls
        .filter((args) => args[0] === 'ps')
        .every((args) => args.includes('label=com.docker.compose.project=isolated'))
    );
    assert.ok(!calls.flat().includes('-v'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('monitor dependency validation follows symlinks before accepting an internal path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-monitor-path-'));
  try {
    const binary = path.join(dir, 'external-node');
    const link = path.join(dir, 'internal-name');
    fs.writeFileSync(binary, 'fixture');
    fs.symlinkSync(binary, link);
    const inspect = (value: string) => ({ uuid: value === fs.realpathSync(binary) ? 'external' : 'system' });
    assert.throws(() => internalPaths([link], inspect, 'linux'), /operating-system volume/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
