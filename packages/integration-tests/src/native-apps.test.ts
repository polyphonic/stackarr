import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('native app router only calls named Immich operations and sends the API key as a header', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-native-apps-'));
  const requests: Array<{ method?: string; url: string; apiKey?: string; authorization?: string; body?: string }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method,
      url: String(input),
      apiKey: headers.get('x-api-key') ?? headers.get('api-key') ?? undefined,
      authorization: headers.get('authorization') ?? undefined,
      body: typeof init?.body === 'string' ? init.body : undefined
    });
    if (new URL(String(input)).pathname === '/statistics/resources') {
      return Response.json({
        MediaContainer: {
          StatisticsResources: [
            {
              at: 200,
              hostCpuUtilization: 20,
              processCpuUtilization: 5,
              hostMemoryUtilization: 60,
              processMemoryUtilization: 8
            },
            {
              at: 100,
              hostCpuUtilization: 10,
              processCpuUtilization: 3,
              hostMemoryUtilization: 55,
              processMemoryUtilization: 7
            }
          ]
        }
      });
    }
    return Response.json({ ok: true, route: new URL(String(input)).pathname });
  };
  const previousDatabaseFile = process.env.STACKARR_DATABASE_FILE;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');

  try {
    const {
      getRoutinesAction,
      getHomelabPerformanceAction,
      getNativeAppCapabilitiesAction,
      administerNativeAppAction,
      assertNativeAppOperationSupported,
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
    } catch {
      blocked = true;
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
    } catch {
      invalidRoutineBlocked = true;
    }

    assert.equal(blocked, true);
    assert.equal(invalidRoutineBlocked, true);
    assert.equal(getRoutinesAction().routines[0]?.id, saved.routine.id);
    assert.equal(due.due, 1);
    assert.equal(dueAgain.due, 0);
    assert.deepEqual(read.result, { ok: true, route: '/api/server/statistics' });
    assert.deepEqual(manage.result, { ok: true, route: '/api/libraries/library_1/scan' });
    assert.deepEqual(requests.slice(0, 3), [
      {
        method: 'GET',
        url: 'http://mock-immich.invalid/api/server/statistics',
        apiKey: 'mock-only-key',
        authorization: undefined,
        body: undefined
      },
      {
        method: 'POST',
        url: 'http://mock-immich.invalid/api/libraries/library_1/scan',
        apiKey: 'mock-only-key',
        authorization: undefined,
        body: undefined
      },
      {
        method: 'GET',
        url: 'http://mock-immich.invalid/api/server/about',
        apiKey: 'mock-only-key',
        authorization: undefined,
        body: undefined
      }
    ]);

    writeEnvConfig({
      ENABLE_PULSARR: 'true',
      PULSARR_URL: 'http://mock-pulsarr.invalid',
      PULSARR_API_KEY: 'pulsarr-test-key',
      ENABLE_TRACEARR: 'true',
      TRACEARR_URL: 'http://mock-tracearr.invalid',
      TRACEARR_API_KEY: 'trr_pub_test',
      ENABLE_TINYMEDIAMANAGER: 'true',
      TINYMEDIAMANAGER_URL: 'http://mock-tmm.invalid',
      TINYMEDIAMANAGER_API_KEY: 'tmm-test-key',
      ENABLE_FLARESOLVERR: 'true',
      FLARESOLVERR_URL: 'http://mock-flaresolverr.invalid',
      ENABLE_RECYCLARR: 'true'
    });

    await readNativeAppAction({ app: 'pulsarr', operation: 'dashboard_stats', limit: 5, days: 14 });
    await readNativeAppAction({ app: 'tracearr', operation: 'health' });
    await manageNativeAppAction({ app: 'flaresolverr', operation: 'create_session', sessionId: 'stackarr-test' });

    let dangerousBlocked = false;
    try {
      await administerNativeAppAction({ app: 'tinymediamanager', operation: 'scrape_new_movies' });
    } catch (error) {
      dangerousBlocked = String(error).includes('confirmDangerous');
    }
    assert.equal(dangerousBlocked, true);
    await administerNativeAppAction({
      app: 'tinymediamanager',
      operation: 'scrape_new_movies',
      confirmDangerous: true,
      reason: 'Mock-only route contract test'
    });

    const capabilities = getNativeAppCapabilitiesAction();
    assert.equal(capabilities.apps.length, 13);
    const recyclarr = capabilities.apps.find((app) => app.app === 'recyclarr');
    assert.deepEqual(
      recyclarr?.readOperations.map((operation) => operation.name),
      ['preview_sync']
    );
    assert.deepEqual(
      recyclarr?.dangerousOperations.map((operation) => operation.name),
      ['sync']
    );
    assert.match(recyclarr?.notice ?? '', /safe Recyclarr preview/);
    const tinyMediaManager = capabilities.apps.find((app) => app.app === 'tinymediamanager');
    assert.deepEqual(
      tinyMediaManager?.dangerousOperations.map((operation) => operation.name),
      ['scrape_new_movies', 'scrape_new_tvshows']
    );
    assert.match(tinyMediaManager?.notice ?? '', /not allowed to rename media/);
    assert.throws(() =>
      assertNativeAppOperationSupported('dangerous', {
        app: 'tinymediamanager',
        operation: 'rename_new_movies'
      })
    );
    assert.equal(
      assertNativeAppOperationSupported('read', { app: 'recyclarr', operation: 'preview_sync', scope: 'radarr' }),
      undefined
    );

    assert.deepEqual(requests.slice(3), [
      {
        method: 'GET',
        url: 'http://mock-pulsarr.invalid/v1/stats/all?limit=5&days=14',
        apiKey: 'pulsarr-test-key',
        authorization: undefined,
        body: undefined
      },
      {
        method: 'GET',
        url: 'http://mock-tracearr.invalid/api/v1/public/health',
        apiKey: undefined,
        authorization: 'Bearer trr_pub_test',
        body: undefined
      },
      {
        method: 'POST',
        url: 'http://mock-flaresolverr.invalid/v1',
        apiKey: undefined,
        authorization: undefined,
        body: JSON.stringify({ cmd: 'sessions.create', session: 'stackarr-test' })
      },
      {
        method: 'POST',
        url: 'http://mock-tmm.invalid/api/movie',
        apiKey: 'tmm-test-key',
        authorization: undefined,
        body: JSON.stringify([
          { action: 'update', scope: { name: 'all' } },
          { action: 'scrape', scope: { name: 'new' } }
        ])
      }
    ]);

    writeEnvConfig({ PLEX_INSTALL_MODE: 'native', PLEX_URL: 'http://mock-plex.invalid', PLEX_TOKEN: 'plex-test' });
    const performance = await getHomelabPerformanceAction();
    assert.equal(performance.available, true);
    assert.equal(performance.provider, 'plex');
    assert.deepEqual(
      performance.points.map((point) => point.at),
      [100, 200]
    );
    assert.equal(performance.points.at(-1)?.hostMemoryPercent, 60);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDatabaseFile === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabaseFile;
    await rm(root, { recursive: true, force: true });
  }
});
