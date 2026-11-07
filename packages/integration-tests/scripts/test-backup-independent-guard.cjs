const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const source = path.resolve(__dirname, '../../../stackarr/scripts/backup-run.sh');

for (const key of ['POSTGRES_DEPLOYMENT_MODE', 'REDIS_DEPLOYMENT_MODE', 'YOUTARR_DATABASE_DEPLOYMENT_MODE']) {
  for (const mode of ['independent', 'external']) {
    test(`full backup refuses ${mode} ${key} before lock or staging`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-mode-'));
      try {
        fs.mkdirSync(path.join(root, 'scripts'));
        fs.mkdirSync(path.join(root, 'lib'));
        fs.copyFileSync(source, path.join(root, 'scripts/backup-run.sh'));
        fs.writeFileSync(
          path.join(root, 'lib/common.sh'),
          `
fail() { printf '%s\\n' "$*" >&2; exit 1; }
load_env() { printf 'load\\n' >> "$EVENTS"; }
maintenance_lock_enter() { printf 'lock\\n' >> "$EVENTS"; exit 74; }
`
        );
        const events = path.join(root, 'events');
        const result = spawnSync('bash', [path.join(root, 'scripts/backup-run.sh')], {
          encoding: 'utf8',
          env: { ...process.env, EVENTS: events, [key]: mode }
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /no full-protection archive created/);
        assert.equal(fs.readFileSync(events, 'utf8'), 'load\n');
        assert.deepEqual(fs.readdirSync(root).sort(), ['events', 'lib', 'scripts']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
