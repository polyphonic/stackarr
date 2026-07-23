import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('Pulsarr MCP actions use documented native API routes and typed quota payloads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-pulsarr-actions-'));
  const requests: Array<{ method?: string; url: string; apiKey?: string; body?: string }> = [];
  const previousFetch = globalThis.fetch;
  const previousDatabaseFile = process.env.STACKARR_DATABASE_FILE;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method,
      url: String(input),
      apiKey: headers.get('x-api-key') ?? undefined,
      body: typeof init?.body === 'string' ? init.body : undefined
    });
    return Response.json({ success: true, route: new URL(String(input)).pathname });
  };

  try {
    const {
      getPulsarrUserDiagnosticsAction,
      listPulsarrUsersAction,
      setPulsarrUserQuotasAction,
      setPulsarrUserSyncAction,
      writeEnvConfig
    } = await import('@stackarr/core');
    writeEnvConfig({
      ENABLE_PULSARR: 'true',
      PULSARR_URL: 'http://mock-pulsarr.invalid',
      PULSARR_API_KEY: 'fixture-pulsarr-key'
    });

    await listPulsarrUsersAction();
    await getPulsarrUserDiagnosticsAction({ userId: 42 });
    await setPulsarrUserSyncAction({ userId: 42, canSync: true });
    await setPulsarrUserQuotasAction({
      userId: 42,
      movieQuota: {
        enabled: true,
        quotaType: 'monthly',
        quotaLimit: 3,
        bypassApproval: false,
        watchlistCap: 8
      },
      showQuota: { enabled: false }
    });

    await assert.rejects(
      () => setPulsarrUserQuotasAction({ userId: 42, movieQuota: { enabled: true, quotaLimit: 3 } }),
      /quotaType/
    );

    assert.equal(requests.length, 8);
    assert.ok(requests.every((request) => request.apiKey === 'fixture-pulsarr-key'));
    assert.deepEqual(
      requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort(),
      [
        'GET /v1/quota/users',
        'GET /v1/quota/users/42',
        'GET /v1/quota/users/42/pending-held-count',
        'GET /v1/users/users/42',
        'GET /v1/users/42/watchlist',
        'GET /v1/users/users/list/with-counts',
        'PATCH /v1/quota/users/42/separate',
        'PATCH /v1/users/users/42'
      ].sort()
    );
    const syncPatch = requests.find(
      (request) => request.method === 'PATCH' && new URL(request.url).pathname === '/v1/users/users/42'
    );
    assert.deepEqual(JSON.parse(syncPatch?.body ?? '{}'), { can_sync: true });
    const update = requests.find((request) => new URL(request.url).pathname === '/v1/quota/users/42/separate');
    assert.deepEqual(JSON.parse(update?.body ?? '{}'), {
      movieQuota: {
        enabled: true,
        quotaType: 'monthly',
        quotaLimit: 3,
        bypassApproval: false,
        watchlistCap: 8
      },
      showQuota: { enabled: false }
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDatabaseFile === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabaseFile;
    await rm(root, { recursive: true, force: true });
  }
});
