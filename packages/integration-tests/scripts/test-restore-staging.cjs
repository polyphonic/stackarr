const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const source = path.resolve(__dirname, '../../../stackarr/scripts/restore.sh');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-placement-'));
  try {
    for (const dir of ['scripts', 'lib', 'backup', 'ambient']) fs.mkdirSync(path.join(root, dir));
    fs.copyFileSync(source, path.join(root, 'scripts/restore.sh'));
    fs.writeFileSync(path.join(root, 'archive.tar.gz'), 'fixture, never extracted');
    fs.writeFileSync(path.join(root, 'lib/common.sh'), `
fail() { printf '%s\\n' "$*" >&2; exit 1; }
load_env() { printf 'load\\n' >> "$EVENTS"; BACKUP_ROOT="$FIXTURE/backup"; BACKUP_STAGING_ROOT="$BACKUP_ROOT/stage"; }
database_mode_is_postgres() { [[ "\${POSTGRES_UNAVAILABLE:-false}" == true ]]; }
load_postgres_runtime_config() { return 1; }
load_compose_runtime_env() { printf 'topology\\n' >> "$EVENTS"; STATE_ROOT="$FIXTURE/state"; }
verify_backup_mounts() { printf 'guard\\n' >> "$EVENTS"; [[ "$DENY" != true ]] || fail 'mount denied'; mkdir -p "$BACKUP_STAGING_ROOT"; }
print_header() { :; }
warn() { :; }
confirm() { return 0; }
python3() { printf 'extract:%s:%s:%s\\n' "$TMPDIR" "$TMP" "$TEMP" >> "$EVENTS"; exit 73; }
`);
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('unavailable runtime requires explicit existing current-host staging', () => fixture((root) => {
  const env = { ...process.env, FIXTURE: root, EVENTS: path.join(root, 'events'), DENY: 'false', POSTGRES_UNAVAILABLE: 'true', TMPDIR: path.join(root, 'ambient') };
  const args = [path.join(root, 'scripts/restore.sh'), path.join(root, 'archive.tar.gz'), '--yes'];
  const denied = spawnSync('bash', args, { env, encoding: 'utf8' });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /Current runtime settings unavailable/);
  assert.equal(fs.readFileSync(env.EVENTS, 'utf8'), 'load\n');
  fs.writeFileSync(env.EVENTS, '');
  const explicit = spawnSync('bash', [...args, '--staging-root', path.join(root, 'backup')], { env, encoding: 'utf8' });
  assert.equal(explicit.status, 73);
  assert.match(fs.readFileSync(env.EVENTS, 'utf8'), /^topology\nguard\nextract:/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'ambient')), []);
}));

for (const key of ['POSTGRES_DEPLOYMENT_MODE', 'REDIS_DEPLOYMENT_MODE', 'YOUTARR_DATABASE_DEPLOYMENT_MODE']) {
  for (const mode of ['independent', 'external']) {
    test(`restore denies ${mode} ${key} before staging`, () => fixture((root) => {
      const env = { ...process.env, FIXTURE: root, EVENTS: path.join(root, 'events'), DENY: 'false', [key]: mode };
      const result = spawnSync('bash', [path.join(root, 'scripts/restore.sh'), path.join(root, 'archive.tar.gz'), '--yes'], { env, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Independent or external database restore/);
      assert.equal(fs.readFileSync(env.EVENTS, 'utf8'), 'load\n');
      assert.deepEqual(fs.readdirSync(path.join(root, 'backup')), []);
    }));
  }
}

for (const deny of [true, false]) {
  test(`restore ${deny ? 'refuses denied mount before scratch' : 'uses verified backup filesystem for scratch'}`, () => fixture((root) => {
    const env = { ...process.env, FIXTURE: root, EVENTS: path.join(root, 'events'), DENY: String(deny), TMPDIR: path.join(root, 'ambient') };
    const result = spawnSync('bash', [path.join(root, 'scripts/restore.sh'), path.join(root, 'archive.tar.gz'), '--yes'], { env, encoding: 'utf8' });
    const events = fs.readFileSync(env.EVENTS, 'utf8');
    assert.match(events, /^load\nguard\n/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'ambient')), []);
    if (deny) {
      assert.match(result.stderr, /mount denied/);
      assert.doesNotMatch(events, /extract:/);
      assert.deepEqual(fs.readdirSync(path.join(root, 'backup')), []);
    } else {
      assert.equal(result.status, 73);
      assert.match(events, /extract:[^\n]*\/backup\/stage\/stackarr-restore\.[^:]*:/);
    }
  }));
}
