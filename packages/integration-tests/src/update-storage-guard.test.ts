import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commonScript = path.join(repoRoot, 'stackarr/lib/common.sh');

test('managed app update storage guard ignores an absent legacy iTunes archive root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-update-storage-'));

  try {
    await execFile('bash', ['-c', 'source "$1"; wait_for_stackarr_storage', 'bash', commonScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STACKARR_STORAGE_WAIT_SECONDS: '0',
        MEDIA_ROOT: '',
        MUSIC_ROOT: '',
        DOWNLOADS_ROOT: '',
        ENABLE_BACKUP: 'false',
        ITUNES_ROOT: path.join(root, 'missing-legacy-itunes-archive')
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
