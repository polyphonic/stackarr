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

function sqliteTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  delete env.STACKARR_DATABASE_MODE;
  delete env.STACKARR_DATABASE_URL;
  delete env.STACKARR_LOG_DATABASE_URL;
  return env;
}

test('controller restart fails only orphaned queued and running tasks', async () => {
  const { interruptedTasksAfterControllerRestart } = await import('../../core/src/tasks.ts');
  const tasks = [
    {
      id: 'old-running',
      commandName: 'SecurityApply' as const,
      commandLabel: 'Apply security credentials',
      status: 'running' as const,
      queuedAt: '2026-08-13T09:00:00.000Z',
      startedAt: '2026-08-13T09:01:00.000Z'
    },
    {
      id: 'old-queued',
      commandName: 'ApplyDownloadsPreset' as const,
      commandLabel: 'Apply downloads preset',
      status: 'queued' as const,
      queuedAt: '2026-08-13T09:02:00.000Z'
    },
    {
      id: 'new-running',
      commandName: 'ApplyNamingPreset' as const,
      commandLabel: 'Apply naming preset',
      status: 'running' as const,
      queuedAt: '2026-08-13T09:06:00.000Z',
      startedAt: '2026-08-13T09:07:00.000Z'
    },
    {
      id: 'recent-handoff',
      commandName: 'SecurityApply' as const,
      commandLabel: 'Apply security credentials',
      status: 'running' as const,
      queuedAt: '2026-08-13T09:00:00.000Z',
      startedAt: '2026-08-13T09:01:00.000Z',
      output: 'STACKARR_TASK_HANDOFF_STARTED Security apply handed to the maintenance worker'
    },
    {
      id: 'completed',
      commandName: 'ApplyNamingPreset' as const,
      commandLabel: 'Apply naming preset',
      status: 'completed' as const,

      queuedAt: '2026-08-13T09:00:00.000Z'
    }
  ];

  const result = interruptedTasksAfterControllerRestart(tasks, '2026-08-13T09:05:00.000Z', '2026-08-13T09:10:00.000Z');

  assert.equal(result[0]?.status, 'failed');
  assert.equal(result[0]?.error, 'Task was interrupted by a Stackarr controller restart.');
  assert.equal(result[1]?.status, 'failed');
  assert.equal(result[2]?.status, 'running');
  assert.equal(result[3]?.status, 'running');
  assert.equal(result[4]?.status, 'completed');
});

test('stale maintenance handoffs fail instead of remaining active forever', async () => {
  const { expireStaleTaskHandoffs } = await import('../../core/src/tasks.ts');
  const tasks = [
    {
      id: 'orphaned-security-worker',
      commandName: 'SecurityApply' as const,
      commandLabel: 'Apply security credentials',
      status: 'running' as const,
      queuedAt: '2026-08-13T09:00:00.000Z',
      startedAt: '2026-08-13T09:01:00.000Z',
      output: 'STACKARR_TASK_HANDOFF_STARTED Security apply handed to the maintenance worker'
    },
    {
      id: 'recent-security-worker',
      commandName: 'SecurityApply' as const,
      commandLabel: 'Apply security credentials',
      status: 'running' as const,
      queuedAt: '2026-08-13T09:08:00.000Z',
      startedAt: '2026-08-13T09:09:00.000Z',
      output: 'STACKARR_TASK_HANDOFF_STARTED Security apply handed to the maintenance worker'
    }
  ];

  const result = expireStaleTaskHandoffs(tasks, '2026-08-13T09:10:00.000Z', 5 * 60 * 1000);

  assert.equal(result[0]?.status, 'failed');
  assert.equal(result[0]?.endedAt, '2026-08-13T09:10:00.000Z');
  assert.equal(result[0]?.exitCode, 1);
  assert.equal(result[0]?.error, 'The maintenance worker did not report completion before the handoff deadline.');
  assert.equal(result[1]?.status, 'running');
});

test('task handoff detection is shared by every command runner', async () => {
  const { commandStartedTaskHandoff } = await import('../../core/src/tasks.ts');

  assert.equal(
    commandStartedTaskHandoff(
      'SecurityApply',
      0,
      'STACKARR_TASK_HANDOFF_STARTED Security apply handed to the maintenance worker'
    ),
    true
  );
  assert.equal(
    commandStartedTaskHandoff(
      'UpdateStackarr',
      0,
      'STACKARR_UPDATE_HANDOFF_STARTED Stackarr update handed to the maintenance worker'
    ),
    true
  );
  assert.equal(commandStartedTaskHandoff('UpdateStackarr', 1, 'STACKARR_UPDATE_HANDOFF_STARTED'), false);
  assert.equal(commandStartedTaskHandoff('Backup', 0, 'STACKARR_TASK_HANDOFF_STARTED'), false);
});

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
        env: sqliteTestEnv({ STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') })
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

test('failed task reviews persist without changing the failure result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-task-review-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { createQueuedTask, readTasks, setTaskReviewState, updateTask } = await import('./packages/core/src/tasks.ts');

          const failed = createQueuedTask('ApplyNamingPreset', 'Apply naming preset');
          const queued = createQueuedTask('ApplyDownloadsPreset', 'Apply downloads preset');
          updateTask(failed.id, { status: 'failed', error: 'test failure' });
          const reviewed = setTaskReviewState([failed.id, queued.id], true);
          const afterReview = readTasks();
          setTaskReviewState([failed.id], false);
          const reopened = readTasks().find((task) => task.id === failed.id);

          console.log(JSON.stringify({ failed, queued, reviewed, afterReview, reopened }));
        `
      ],
      {
        cwd: repoRoot,
        env: sqliteTestEnv({ STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') })
      }
    );

    const result = JSON.parse(stdout) as {
      failed: { id: string };
      queued: { id: string };
      reviewed: Array<{ id: string; status: string; reviewedAt?: string }>;
      afterReview: Array<{ id: string; status: string; reviewedAt?: string }>;
      reopened?: { status: string; reviewedAt?: string | null };
    };
    assert.deepEqual(
      result.reviewed.map((task) => task.id),
      [result.failed.id]
    );
    assert.equal(result.reviewed[0]?.status, 'failed');
    assert.ok(result.reviewed[0]?.reviewedAt);
    assert.ok(result.afterReview.find((task) => task.id === result.failed.id)?.reviewedAt);
    assert.equal(result.afterReview.find((task) => task.id === result.queued.id)?.reviewedAt, undefined);
    assert.equal(result.reopened?.status, 'failed');
    assert.equal(result.reopened?.reviewedAt, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('existing task databases gain review state without losing history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-task-migration-test-'));
  const databasePath = path.join(root, 'stackarr.db');

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { DatabaseSync } = await import('node:sqlite');
          const database = new DatabaseSync(process.env.STACKARR_DATABASE_FILE);
          database.exec(\`
            create table tasks (
              id text primary key,
              command_name text not null,
              command_label text not null,
              status text not null,
              queued_at text not null,
              started_at text,
              ended_at text,
              exit_code integer,
              output text,
              error text,
              created_at text not null default (datetime('now')),
              updated_at text not null default (datetime('now'))
            );
            insert into tasks (id, command_name, command_label, status, queued_at, error)
            values ('legacy-failure', 'ApplyNamingPreset', 'Apply naming preset', 'failed', '2026-07-26T00:00:00.000Z', 'legacy failure');
          \`);
          database.close();

          const { readTasks, setTaskReviewState } = await import('./packages/core/src/tasks.ts');
          const before = readTasks();
          setTaskReviewState(['legacy-failure'], true);
          const after = readTasks();
          console.log(JSON.stringify({ before, after }));
        `
      ],
      {
        cwd: repoRoot,
        env: sqliteTestEnv({ STACKARR_DATABASE_FILE: databasePath })
      }
    );

    const result = JSON.parse(stdout) as {
      before: Array<{ id: string; status: string; reviewedAt?: string }>;
      after: Array<{ id: string; status: string; reviewedAt?: string }>;
    };
    assert.equal(result.before[0]?.id, 'legacy-failure');
    assert.equal(result.before[0]?.reviewedAt, undefined);
    assert.equal(result.after[0]?.status, 'failed');
    assert.ok(result.after[0]?.reviewedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
