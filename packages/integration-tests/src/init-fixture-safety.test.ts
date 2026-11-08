import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createInitFixture, initAnswers, installerNames } from './helpers/init-fixture';

// Run this denial suite before exercising the real init flow. None of these
// probes can reach the host installer: only the tiny fixture input set is copied.
for (const command of [
  'launchctl print gui/999/com.stackarr.stack',
  '/bin/launchctl print gui/999/com.stackarr.stack',
  'command launchctl print gui/999/com.stackarr.stack',
  '/usr/bin/env launchctl print gui/999/com.stackarr.stack',
  'systemctl show stackarr',
  'crontab -l',
  'docker version',
  'install_managed_host_runtime'
]) {
  test(`init fixture fails closed at the process boundary: ${command.split(' ')[0]}`, () => {
    const fixture = createInitFixture();
    try {
      const result = fixture.run(['-c', command]);
      assert.equal(result.status, 97, result.stderr);
      assert.match(fs.readFileSync(fixture.denied, 'utf8'), /DENIED/);
    } finally {
      fixture.close();
    }
  });
}
for (const name of installerNames) {
  test(`init fixture never stages the real ${name}`, () => {
    const fixture = createInitFixture();
    try {
      const script = path.join(fixture.sourceRoot, 'scripts', name);
      for (const args of [
        [script, 'install', '--quiet'],
        ['-c', '"$1" install --quiet', 'fixture', script]
      ]) {
        const result = fixture.run(args);
        assert.equal(result.status, 97, result.stderr);
      }
      assert.match(fs.readFileSync(fixture.denied, 'utf8'), new RegExp(name));
    } finally {
      fixture.close();
    }
  });
}
test('init fixture passes only its explicit environment and configured scratch directory', () => {
  const fixture = createInitFixture();
  try {
    const env = fixture.environment(path.join(fixture.root, 'home'));
    assert.deepEqual(Object.keys(env).sort(), [
      'APP_ROOT_DEFAULT_OVERRIDE',
      'BASH_ENV',
      'ENABLE_MOVIES',
      'ENABLE_MUSIC',
      'ENABLE_TV',
      'FIXTURE_DENIAL_LOG',
      'HOME',
      'LANG',
      'LC_ALL',
      'PATH',
      'STACKARR_DATABASE_FILE',
      'STACKARR_DATABASE_URL',
      'TMPDIR'
    ]);
    assert.equal(env.TMPDIR, path.join(fixture.root, 'tmp'));
    if (process.env.TMPDIR) assert.equal(path.dirname(fixture.root), path.resolve(process.env.TMPDIR));
    assert.equal(env.STACKARR_DATABASE_URL, '');
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.STACKARR_REPO_ROOT, undefined);
    assert.equal(env.DOCKER_HOST, undefined);
    assert.equal(env.STACKARR_STORAGE_POLICY, undefined);
  } finally {
    fixture.close();
  }
});

for (const [name, confirmations, reads, expectedInstaller] of [
  ['historical off-by-one input', ['n', 'n', 'n'], 37, 'startup-install.sh'],
  ['startup accepted', ['y', 'n', 'n'], 36, 'startup-install.sh'],
  ['backup accepted', ['n', 'y', 'n'], 36, 'backup-install.sh'],
  ['update accepted', ['n', 'n', 'y'], 36, 'update-install.sh']
] as const) {
  test(`real init refuses ${name} before host automation`, () => {
    const fixture = createInitFixture();
    try {
      const result = fixture.run(
        [path.join(fixture.sourceRoot, 'scripts', 'init.sh')],
        fixture.environment(path.join(fixture.root, 'home')),
        initAnswers(false, [...confirmations], reads)
      );
      assert.equal(result.status, 97, result.stderr);
      assert.match(fs.readFileSync(fixture.denied, 'utf8'), new RegExp(expectedInstaller));
      assert.equal(fs.existsSync(path.join(fixture.root, 'home', 'Library', 'LaunchAgents')), false);
      assert.equal(fs.existsSync(path.join(fixture.root, 'home', 'state', 'host-runtime')), false);
    } finally {
      fixture.close();
    }
  });
}
