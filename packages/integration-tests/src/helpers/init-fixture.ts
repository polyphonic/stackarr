import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const productRoot = fileURLToPath(new URL('../../../../stackarr/', import.meta.url));
const inputs = [
  'scripts/init.sh',
  'lib/common.sh',
  'lib/storage-guard.sh',
  'scripts/runtime-config-write.cjs',
  'scripts/stackarr-db.cjs'
];
export const installerNames = ['startup-install.sh', 'backup-install.sh', 'update-install.sh'];

// This is an init-script fixture, not an OS sandbox. Never stage real installers.
// An allowlisted environment, denied process boundaries and a private source tree
// prevent prompt drift from installing jobs in the developer's real launch domain.
export function createInitFixture() {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'media-init-'));
  const sourceRoot = path.join(root, 'source');
  const bin = path.join(root, 'bin');
  const tmp = path.join(root, 'tmp');
  const denied = path.join(root, 'denied.log');
  const guard = path.join(root, 'guard.sh');
  for (const directory of [sourceRoot, bin, tmp]) fs.mkdirSync(directory, { recursive: true });
  for (const relative of inputs) {
    const target = path.join(sourceRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(productRoot, relative), target);
  }
  fs.writeFileSync(denied, '');
  const refusal = `#!/bin/bash
printf 'DENIED %s\\n' "$0" >> "$FIXTURE_DENIAL_LOG"
printf 'Init fixture refused host automation\\n' >&2
exit 97
`;
  for (const installer of installerNames) {
    fs.writeFileSync(path.join(sourceRoot, 'scripts', installer), refusal, { mode: 0o755 });
  }
  for (const command of ['launchctl', 'systemctl', 'service', 'crontab', 'sudo', 'docker', 'portless', 'psql']) {
    fs.writeFileSync(path.join(bin, command), refusal, { mode: 0o755 });
  }
  // The DEBUG trap also rejects absolute binaries and `command launchctl`, which
  // bypass PATH shims. The launcher explicitly sources this fixed guard because
  // some system Bash builds do not read BASH_ENV in noninteractive children.
  fs.writeFileSync(
    guard,
    `set -o functrace
fixture_guard() {
  local blocked='^((command|exec|env|/usr/bin/env)[[:space:]]+)*([^[:space:]]*/)?(launchctl|systemctl|service|crontab|sudo|docker|portless|psql|install_managed_host_runtime)([[:space:]]|$)'
  if [[ "$1" =~ $blocked ]]; then
    printf 'DENIED shell boundary\\n' >> "$FIXTURE_DENIAL_LOG"
    printf 'Init fixture refused host automation\\n' >&2
    exit 97
  fi
}
trap 'fixture_guard "$BASH_COMMAND"' DEBUG
`
  );
  function environment(home: string): NodeJS.ProcessEnv {
    fs.mkdirSync(home, { recursive: true });
    return {
      PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter),
      HOME: home,
      TMPDIR: tmp,
      LANG: 'C',
      LC_ALL: 'C',
      BASH_ENV: guard,
      FIXTURE_DENIAL_LOG: denied,
      APP_ROOT_DEFAULT_OVERRIDE: home,
      STACKARR_DATABASE_FILE: path.join(home, 'config', 'stackarr.db'),
      STACKARR_DATABASE_URL: '',
      ENABLE_MOVIES: '1',
      ENABLE_TV: '1',
      ENABLE_MUSIC: '1'
    };
  }
  function run(args: string[], env = environment(path.join(root, 'home')), input = '') {
    const guardedArgs =
      args[0] === '-c'
        ? ['-c', `source "$BASH_ENV"\n${args[1]}`, args[2] ?? 'fixture', ...args.slice(3)]
        : ['-c', 'source "$BASH_ENV"; source "$0" "$@"', ...args];
    return spawnSync('/bin/bash', guardedArgs, { cwd: root, env, input, encoding: 'utf8', timeout: 30_000 });
  }
  return {
    root,
    sourceRoot,
    denied,
    environment,
    run,
    assertUntouched() {
      assert.equal(fs.readFileSync(denied, 'utf8'), '', 'init attempted host automation');
      for (const name of fs.readdirSync(root)) {
        assert.equal(fs.existsSync(path.join(root, name, 'Library', 'LaunchAgents')), false);
        assert.equal(fs.existsSync(path.join(root, name, 'state', 'host-runtime')), false);
      }
    },
    close() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

// There are 36 setup reads before the three automation confirmations. Keep the
// denials even with correct input: prompt additions must fail, not install jobs.
export function initAnswers(existing: boolean, automation = ['n', 'n', 'n'], setupReads = 36) {
  return [...(existing ? ['y'] : []), ...Array(setupReads).fill(''), ...automation].join('\n') + '\n';
}
