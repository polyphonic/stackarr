import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const policy = require('../../../stackarr/scripts/storage-policy.cjs');
const control = path.join(repo, 'stackarr/scripts/storage-control.cjs');
const guard = path.join(repo, 'stackarr/lib/storage-guard.sh');

// Real shell guard and real host usage responder; only OS volume identity is
// injected, since the test must not create mounts or use an installed runtime.
test('updater accepts a host-proven Downloads child and refuses loss of identity without creating it', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-updater-proof-'));
  const app = path.join(base, 'app');
  const state = path.join(app, 'state');
  const media = path.join(base, 'media');
  const downloads = path.join(media, 'Downloads');
  const archive = path.join(downloads, 'torrents');
  const other = path.join(base, 'other');
  const file = path.join(state, 'storage-policy.json');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  fs.mkdirSync(other);
  fs.mkdirSync(path.join(state, 'storage-bridge'));
  const mountPoint = execFileSync('df', ['-kP', base], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .at(-1)!
    .match(/\d+%\s+(.+)$/)![1];
  const probe = () => ({ mountPoint, uuid: 'fixture-volume', filesystem: 'apfs', readOnly: false });
  const records = [policy.captureRoot(media, { probe }), policy.captureRoot(other, { probe })];
  const save = (roots = records) => fs.writeFileSync(file, JSON.stringify({ version: 1, roots }));
  save();
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const fs = require('node:fs');
    const path = require('node:path');
    const p = require(path.join(path.dirname(process.argv[1]), 'storage-policy.cjs'));
    const capture = p.captureRoot, verify = p.verifyRoot;
    const probe = () => ({ mountPoint: process.argv[3],
      uuid: fs.existsSync(process.argv[4]) ? 'replaced-volume' : 'fixture-volume',
      filesystem: 'apfs', readOnly: false });
    p.captureRoot = (target, options) => capture(target, {...options, probe});
    p.verifyRoot = (record, options) => verify(record, {...options, probe});
    const c = require(process.argv[1]);
    setInterval(() => c.respond(process.argv[2], () => {
      const current = p.readPolicy(process.argv[2]);
      for (const root of current.roots) p.verifyRoot(root, {probe});
    }), 15);
    process.stdout.write('ready');
  `,
      control,
      file,
      mountPoint,
      path.join(base, 'replaced')
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    ROOT_DIR: path.join(repo, 'stackarr'),
    APP_ROOT: app,
    STATE_ROOT: state,
    CONFIG_ROOT: path.join(app, 'config'),
    LOG_ROOT: path.join(app, 'logs'),
    BACKUP_ROOT: path.join(app, 'backups'),
    BACKUP_STAGING_ROOT: path.join(base, 'staging'),
    DOWNLOADS_ROOT: downloads,
    STACKARR_RUNTIME: 'docker-updater',
    TORRENT_ARCHIVE_ROOT: archive,
    STACKARR_STORAGE_POLICY: file
  };
  const check = () =>
    spawnSync(
      'bash',
      [
        '-c',
        'fail(){ echo "$*" >&2; exit 1; }; require_command(){ command -v "$1" >/dev/null; }; source "$1"; stackarr_verify_torrent_archive_root',
        'fixture',
        guard
      ],
      { env, encoding: 'utf8', timeout: 12000 }
    );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('responder timeout')), 2000);
      child.stdout.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('error', reject);
    });
    const first = check();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.existsSync(archive), false, 'preflight must not create archive');
    fs.symlinkSync(other, path.join(downloads, 'alias'));
    env.TORRENT_ARCHIVE_ROOT = path.join(downloads, 'alias', 'torrents');
    assert.notEqual(check().status, 0, 'symlink escape');
    env.TORRENT_ARCHIVE_ROOT = archive;
    fs.writeFileSync(path.join(base, 'replaced'), '');
    assert.notEqual(check().status, 0, 'replaced volume');
    fs.rmSync(path.join(base, 'replaced'));
    save([records[1]]);
    assert.notEqual(check().status, 0, 'unenrolled media');
    save();
    fs.renameSync(downloads, path.join(media, 'unavailable'));
    assert.notEqual(check().status, 0, 'missing Downloads bind');
    assert.equal(fs.existsSync(downloads), false, 'refusal must not create missing bind');
    fs.renameSync(path.join(media, 'unavailable'), downloads);
    assert.equal(check().status, 0, 'recovered mount');
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    assert.notEqual(check().status, 0, 'absent host proof');
    assert.equal(fs.existsSync(archive), false);
    env.TORRENT_ARCHIVE_ROOT = path.join(state, 'torrent-archive');
    assert.equal(check().status, 0, 'default state archive remains supported');
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
