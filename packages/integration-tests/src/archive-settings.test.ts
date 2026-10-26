import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateTorrentArchiveRoot } from '../../core/src/archiveRootValidation.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('archive-only save never queues StackStart and reports pending migration', async () => {
  const source = await readFile(path.join(root, 'apps/frontend/src/components/SettingsEditor.tsx'), 'utf8');
  const mountKeys = source.match(/const storageEnvKeys = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  assert.doesNotMatch(mountKeys, /TORRENT_ARCHIVE_ROOT/);
  assert.match(source, /const archiveChanged = envValue\('TORRENT_ARCHIVE_ROOT'\)/);
  const save = source.slice(
    source.indexOf('async function save()'),
    source.indexOf('async function rotateTunnelToken()')
  );
  assert.ok(save.indexOf('if (archiveChanged) {') < save.indexOf("name: 'StackStart'"));
  assert.match(save, /Saved, not applied.*migrat/i);
  assert.match(source, /controller's archive bind.*backup coverage/);
});

test('archive path save rejects unsafe lexical paths and overlapping storage', () => {
  const roots = {
    config: '/srv/stackarr/config',
    state: '/srv/stackarr/state',
    logs: '/srv/stackarr/logs',
    backup: '/srv/backups',
    staging: '/srv/staging'
  };
  const validate = (value: unknown) => validateTorrentArchiveRoot(value, '/srv/stackarr/state/torrent-archive', roots);
  assert.equal(validate('/srv/stackarr/state/torrent-archive'), null);
  assert.match(validate('/srv/stackarr/state/new-archive') ?? '', /state root/);
  assert.equal(validate('/srv/downloads/torrent-archive'), null);
  assert.match(validate('relative/archive') ?? '', /absolute host path/);
  assert.match(validate('/srv/stackarr/../escape') ?? '', /traversal/);
  assert.match(validate('/srv/backups/archive') ?? '', /backup root/);
  assert.match(validate('/srv/staging/archive') ?? '', /staging root/);
  assert.match(validate('/srv/stackarr/logs/archive') ?? '', /logs root/);
  assert.match(validate('/srv/stackarr/config/archive') ?? '', /config root/);
  assert.match(validate('/srv/stackarr') ?? '', /root/);
  assert.match(validate('/srv/alternate:archive') ?? '', /Compose separators/);
  assert.match(validate('/Volumes/ExampleStorage/archive') ?? '', /enrolled storage policy/);
});

test('unchanged and omitted archive fields still validate proposed storage roots', () => {
  const archive = '/srv/downloads/torrent-archive';
  const roots = {
    config: '/srv/stackarr/config',
    state: '/srv/stackarr/state',
    logs: '/srv/stackarr/logs',
    backup: '/srv/backups',
    staging: '/srv/staging'
  };
  for (const requested of [undefined, archive]) {
    assert.equal(validateTorrentArchiveRoot(requested, archive, roots), null);
    for (const key of ['config', 'state', 'logs', 'backup', 'staging'] as const) {
      for (const proposedRoot of [archive, `${archive}/nested`, '/srv']) {
        assert.match(
          validateTorrentArchiveRoot(requested, archive, { ...roots, [key]: proposedRoot }) ?? '',
          new RegExp(`${key} root`)
        );
      }
    }
  }
  assert.equal(validateTorrentArchiveRoot(undefined, undefined, roots), null);
  assert.match(
    validateTorrentArchiveRoot(undefined, undefined, { ...roots, config: `${roots.state}/torrent-archive` }) ?? '',
    /config root/
  );
});

test('save and host guard agree on managed roots, standard state child and aliases', () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'stackarr-archive-save-'));
  try {
    const app = path.join(base, 'app');
    const roots = {
      config: path.join(app, 'config'),
      state: path.join(app, 'state'),
      logs: path.join(app, 'logs'),
      backup: path.join(app, 'backups'),
      staging: path.join(base, 'staging')
    };
    for (const dir of Object.values(roots)) fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(base, 'downloads'));
    fs.symlinkSync(roots.config, path.join(base, 'config-alias'));
    const cases = [
      [path.join(roots.state, 'torrent-archive'), true],
      [path.join(base, 'downloads/torrents'), true],
      [path.join(roots.state, 'other'), false],
      [roots.state, false],
      [path.join(roots.config, 'archive'), false],
      [path.join(roots.logs, 'archive'), false],
      [path.join(roots.backup, 'archive'), false],
      [path.join(roots.staging, 'archive'), false],
      [path.join(base, 'config-alias/archive'), false],
      [app, false]
    ] as const;
    for (const [candidate, accepted] of cases) {
      const saveAccepted = validateTorrentArchiveRoot(candidate, undefined, roots) === null;
      const guard = spawnSync(
        'bash',
        [
          '-c',
          'fail(){ exit 1; }; require_command(){ command -v "$1" >/dev/null; }; source "$1"; stackarr_verify_torrent_archive_root',
          'fixture',
          path.join(root, 'stackarr/lib/storage-guard.sh')
        ],
        {
          env: {
            ...process.env,
            CONFIG_ROOT: roots.config,
            STATE_ROOT: roots.state,
            LOG_ROOT: roots.logs,
            BACKUP_ROOT: roots.backup,
            BACKUP_STAGING_ROOT: roots.staging,
            TORRENT_ARCHIVE_ROOT: candidate
          },
          encoding: 'utf8'
        }
      );
      assert.equal(saveAccepted, accepted, `save ${candidate}`);
      assert.equal(guard.status === 0, accepted, `guard ${candidate}: ${guard.stderr}`);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
