import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const transmissionHook = path.join(repoRoot, 'stackarr/scripts/hooks/transmission-delete-unsafe.sh');

test('Transmission unsafe hook rejects torrent names with Windows separators', async () => {
  await execFile('sh', [transmissionHook], {
    env: {
      ...process.env,
      TR_TORRENT_DIR: tmpdir(),
      TR_TORRENT_NAME: 'Safe Album',
      TR_TORRENT_ID: '1'
    }
  });

  await assert.rejects(
    execFile('sh', [transmissionHook], {
      env: {
        ...process.env,
        TR_TORRENT_DIR: tmpdir(),
        TR_TORRENT_NAME: 'Bad\\Album',
        TR_TORRENT_ID: '2'
      }
    }),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, 1);
      assert.match((error as { stderr?: string }).stderr ?? '', /removed unsafe torrent name: Bad\\Album/);
      return true;
    }
  );
});
