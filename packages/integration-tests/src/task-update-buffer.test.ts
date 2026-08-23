import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBufferedTaskUpdater } from '../../../apps/frontend/src/lib/task-update-buffer.ts';

test('task persistence buffers merged output and terminal state across a transient database outage', () => {
  type Patch = { output?: string; status?: string };
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const persisted: Array<{ id: string; patch: Partial<Patch> }> = [];
  let failuresRemaining = 2;
  const updater = createBufferedTaskUpdater<Patch>(
    (id, patch) => {
      persisted.push({ id, patch });
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('database temporarily unavailable');
      }
    },
    {
      retryDelayMs: 5,
      maxRetryDelayMs: 20,
      scheduleRetry(callback, delayMs) {
        callbacks.push(callback);
        delays.push(delayMs);
        return undefined;
      }
    }
  );

  assert.doesNotThrow(() => updater.update('task-1', { output: 'partial' }));
  updater.update('task-1', { output: 'complete', status: 'completed' });
  assert.equal(updater.pendingCount(), 1);
  assert.deepEqual(delays, [5]);

  callbacks.shift()?.();
  assert.equal(updater.pendingCount(), 1);
  assert.deepEqual(delays, [5, 10]);

  callbacks.shift()?.();
  assert.equal(updater.pendingCount(), 0);
  assert.deepEqual(persisted.at(-1), {
    id: 'task-1',
    patch: { output: 'complete', status: 'completed' }
  });
});

test('task persistence writes immediately when the database is available', () => {
  const persisted: Array<{ id: string; patch: { output?: string } }> = [];
  const updater = createBufferedTaskUpdater<{ output?: string }>((id, patch) => {
    persisted.push({ id, patch });
  });

  updater.update('task-2', { output: 'done' });

  assert.deepEqual(persisted, [{ id: 'task-2', patch: { output: 'done' } }]);
  assert.equal(updater.pendingCount(), 0);
});
