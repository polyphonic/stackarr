import { execFile as execFileCallback } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

for (const fixture of [
  'test-torrent-archive.py',
  'test-torrent-archive-current-hook.py',
  'test-torrent-metadata-capture.py',
  'test-torrent-current-sources.py',
  'test-torrent-current-inventory.py',
  'test-torrent-archive-worker.py'
]) {
  test(`torrent archive fixture: ${fixture}`, async () => {
    const script = fileURLToPath(new URL(`../scripts/${fixture}`, import.meta.url));
    await execFile('python3', [script], { timeout: 90_000 });
  });
}
