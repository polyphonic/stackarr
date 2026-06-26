import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commonScript = path.join(repoRoot, 'stackarr/lib/common.sh');

test('compose env generation preserves runtime roots and the release image', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-compose-env-test-'));
  const composeEnvFile = path.join(root, 'stackarr.env');
  const mediaRoot = '/mnt/stackarr-media';

  try {
    await execFile('bash', ['-c', 'source "$1"; load_env; write_compose_env_file', 'bash', commonScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_ROOT: path.join(root, 'app'),
        CONFIG_ROOT: path.join(root, 'app/config'),
        STATE_ROOT: path.join(root, 'app/state'),
        LOG_ROOT: path.join(root, 'app/logs'),
        MEDIA_ROOT: mediaRoot,
        MUSIC_ROOT: `${mediaRoot}/Music`,
        DOWNLOADS_ROOT: `${mediaRoot}/Downloads`,
        BACKUP_ROOT: `${mediaRoot}/Backups/Plex`,
        STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        STACKARR_IMAGE: 'polyphonic/stackarr:alpha',
        STACKARR_WEB_ENABLED: 'true',
        PASSWORD: 'Portable435',
        UNRELATED_SECRET: 'should-not-be-written'
      }
    });

    const content = await readFile(composeEnvFile, 'utf8');
    const mode = (await stat(composeEnvFile)).mode & 0o777;

    assert.equal(mode, 0o600);
    assert.match(content, /^MEDIA_ROOT="\/mnt\/stackarr-media"$/m);
    assert.match(content, /^MUSIC_ROOT="\/mnt\/stackarr-media\/Music"$/m);
    assert.match(content, /^DOWNLOADS_ROOT="\/mnt\/stackarr-media\/Downloads"$/m);
    assert.match(content, /^BACKUP_ROOT="\/mnt\/stackarr-media\/Backups\/Plex"$/m);
    assert.match(content, /^STACKARR_IMAGE="polyphonic\/stackarr:alpha"$/m);
    assert.doesNotMatch(content, /UNRELATED_SECRET/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
