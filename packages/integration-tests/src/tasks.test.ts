import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('task updates patch one row without dropping newer queued tasks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-tasks-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { createQueuedTask, readTasks, updateTask } = await import('./packages/core/src/tasks.ts');

          const first = createQueuedTask('ApplyNamingPreset', 'Apply naming preset');
          const second = createQueuedTask('ApplyDownloadsPreset', 'Apply downloads preset');
          updateTask(first.id, { status: 'running', output: 'still here' });

          console.log(JSON.stringify({
            first,
            second,
            tasks: readTasks().map((task) => ({
              id: task.id,
              status: task.status,
              output: task.output ?? ''
            }))
          }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    type TaskRow = { id: string; status: string; output: string };
    const result = JSON.parse(stdout) as { first: { id: string }; second: { id: string }; tasks: TaskRow[] };
    const byId = new Map<string, TaskRow>(result.tasks.map((task) => [task.id, task]));
    assert.equal(byId.get(result.first.id)?.status, 'running');
    assert.equal(byId.get(result.first.id)?.output, 'still here');
    assert.equal(byId.get(result.second.id)?.status, 'queued');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
