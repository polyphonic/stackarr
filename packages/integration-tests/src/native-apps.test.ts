import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('native app router only calls named Immich operations and sends the API key as a header', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-native-apps-'));
  const requests: Array<{ method?: string; url: string; apiKey?: string }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ method: init?.method, url: String(input), apiKey: headers.get('x-api-key') ?? undefined });
    return Response.json({ ok: true, route: new URL(String(input)).pathname });
  };
  const previousDatabaseFile = process.env.STACKARR_DATABASE_FILE;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');

  try {
    const {
      getRoutinesAction,
      manageNativeAppAction,
      readNativeAppAction,
      runDueRoutinesAction,
      saveRoutineAction,
      writeEnvConfig
    } = await import('@stackarr/core');
    writeEnvConfig({
      ENABLE_IMMICH: 'true',
      IMMICH_URL: 'http://mock-immich.invalid',
      IMMICH_API_KEY: 'mock-only-key'
    });
    const read = await readNativeAppAction({ app: 'immich', operation: 'statistics' });
    const manage = await manageNativeAppAction({ app: 'immich', operation: 'scan_library', libraryId: 'library_1' });
    let blocked = false;
    try {
      await readNativeAppAction({ app: 'immich', operation: '../users' });
    } catch (error) {
      blocked = String(error).includes('Unsupported read operation');
    }
    const saved = saveRoutineAction({
      name: 'Daily photo health',
      steps: [{ kind: 'read_app', app: 'immich', operation: 'about' }],
      schedule: { frequency: 'daily', time: '00:00' }
    });
    const due = await runDueRoutinesAction(new Date());
    const dueAgain = await runDueRoutinesAction(new Date());
    let invalidRoutineBlocked = false;
    try {
      saveRoutineAction({
        name: 'Unsafe proxy attempt',
        steps: [{ kind: 'read_app', app: 'immich', operation: '../users' }]
      });
    } catch (error) {
      invalidRoutineBlocked = String(error).includes('Unsupported read operation');
    }

    assert.equal(blocked, true);
    assert.equal(invalidRoutineBlocked, true);
    assert.equal(getRoutinesAction().routines[0]?.id, saved.routine.id);
    assert.equal(due.due, 1);
    assert.equal(dueAgain.due, 0);
    assert.deepEqual(read.result, { ok: true, route: '/api/server/statistics' });
    assert.deepEqual(manage.result, { ok: true, route: '/api/libraries/library_1/scan' });
    assert.deepEqual(requests, [
      {
        method: 'GET',
        url: 'http://mock-immich.invalid/api/server/statistics',
        apiKey: 'mock-only-key'
      },
      {
        method: 'POST',
        url: 'http://mock-immich.invalid/api/libraries/library_1/scan',
        apiKey: 'mock-only-key'
      },
      {
        method: 'GET',
        url: 'http://mock-immich.invalid/api/server/about',
        apiKey: 'mock-only-key'
      }
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDatabaseFile === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabaseFile;
    await rm(root, { recursive: true, force: true });
  }
});
