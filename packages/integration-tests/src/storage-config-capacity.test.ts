import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const reader = path.resolve(import.meta.dirname, '../../../stackarr/scripts/storage-config-read.cjs');

test('capacity opt-in borrows bounded native preference only inside a controller; raw record remains unchanged', () => {
  const root = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'capacity-reader-'));
  try {
    const dbFile = path.join(root, 'settings.db');
    const prefs = path.join(root, 'preferences.plist');
    writeFileSync(prefs, 'fixture preferences');
    const record: Record<string, string> = {
      STATE_ROOT: path.join(root, 'state'),
      PLEX_INSTALL_MODE: 'native',
      PLEX_PREFS_PATH: prefs
    };
    const db = new DatabaseSync(dbFile);
    db.exec('create table app_settings (key text primary key, value text)');
    const insert = db.prepare('insert into app_settings values (?, ?)');
    insert.run('stackarr.runtimeConfig', JSON.stringify(record));
    db.close();
    const before = readFileSync(dbFile);
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const python = path.join(bin, 'python3');
    writeFileSync(python, '#!/bin/sh\nprintf %s fixture-plex-token\n', { mode: 0o755 });
    const preload = path.join(root, 'container.cjs');
    writeFileSync(
      preload,
      `const fs=require('node:fs'); const original=fs.existsSync; fs.existsSync=(p)=>p==='/.dockerenv' ? true : original(p); Object.defineProperty(process,'platform',{value:'linux'});`
    );
    const hostPreload = path.join(root, 'host.cjs');
    writeFileSync(hostPreload, `Object.defineProperty(process,'platform',{value:'darwin'});`);
    const env = {
      ...process.env,
      STACKARR_DATABASE_FILE: dbFile,
      STACKARR_DATABASE_MODE: 'sqlite',
      STACKARR_DATABASE_URL: '',
      PATH: `${bin}:${process.env.PATH}`
    };
    const read = (flag: boolean, simulated: boolean) =>
      spawnSync(
        process.execPath,
        ['--require', simulated ? preload : hostPreload, reader, ...(flag ? ['--capacity-discovery'] : [])],
        { encoding: 'utf8', env }
      );
    assert.deepEqual(JSON.parse(read(false, true).stdout), record);
    assert.deepEqual(JSON.parse(read(true, false).stdout), record); // macOS host guard
    const enriched = read(true, true);
    assert.equal(enriched.status, 0, enriched.stderr);
    assert.deepEqual(JSON.parse(enriched.stdout), { ...record, PLEX_TOKEN: 'fixture-plex-token' });
    const stdinReader = spawnSync(process.execPath, ['--require', preload, '-', '--capacity-discovery'], {
      encoding: 'utf8',
      env,
      input: readFileSync(reader)
    });
    assert.equal(stdinReader.status, 0, stdinReader.stderr);
    assert.deepEqual(JSON.parse(stdinReader.stdout), { ...record, PLEX_TOKEN: 'fixture-plex-token' });
    assert.deepEqual(readFileSync(dbFile), before);
    assert.doesNotMatch(read(true, true).stderr, /fixture-plex-token/);
    const plist = spawnSync(
      'python3',
      [
        '-c',
        "import plistlib,sys; open(sys.argv[1],'wb').write(plistlib.dumps({'PlexOnlineToken':'plist-fixture-token'}))",
        prefs
      ],
      { encoding: 'utf8' }
    );
    assert.equal(plist.status, 0, plist.stderr);
    const realPython = spawnSync(process.execPath, ['--require', preload, reader, '--capacity-discovery'], {
      encoding: 'utf8',
      env: { ...env, PATH: process.env.PATH }
    });
    assert.equal(JSON.parse(realPython.stdout).PLEX_TOKEN, 'plist-fixture-token');
    writeFileSync(prefs, 'fixture preferences');
    for (const invalid of ['relative.plist', `${prefs}\n`, path.join(root, '..', 'preferences.plist')]) {
      insertRecord({ ...record, PLEX_PREFS_PATH: invalid });
      assert.equal(JSON.parse(read(true, true).stdout).PLEX_TOKEN, undefined);
    }
    insertRecord({ ...record, PLEX_TOKEN: 'already-configured' });
    assert.equal(JSON.parse(read(true, true).stdout).PLEX_TOKEN, 'already-configured');
    insertRecord(record);
    writeFileSync(prefs, 'x'.repeat(1024 * 1024 + 1));
    assert.equal(JSON.parse(read(true, true).stdout).PLEX_TOKEN, undefined);
    writeFileSync(prefs, 'fixture preferences');
    writeFileSync(python, '#!/bin/sh\nprintf "bad\\ntoken"\n', { mode: 0o755 });
    assert.equal(JSON.parse(read(true, true).stdout).PLEX_TOKEN, undefined);
    function insertRecord(value: Record<string, string>) {
      const writable = new DatabaseSync(dbFile);
      writable
        .prepare('update app_settings set value = ? where key = ?')
        .run(JSON.stringify(value), 'stackarr.runtimeConfig');
      writable.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
