import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'stackarr-agregarr-mcp-'));
process.env.STACKARR_DATABASE_FILE = path.join(tempRoot, 'stackarr.sqlite');
process.env.STACKARR_CONFIG_MODE = 'db';

const requests: Array<{ method: string; url: string; apiKey?: string; body?: string }> = [];
const originalFetch = globalThis.fetch;
const collections: Array<Record<string, unknown>> = [
  {
    id: 10012,
    name: 'Coming Soon',
    type: 'comingsoon',
    subtype: 'monitored',
    mediaType: 'movie',
    libraryId: '2',
    libraryName: 'Movies',
    sortOrder: 'default',
    sortOrderHome: 2,
    randomizeHomeOrder: false,
    visibilityConfig: { serverOwnerHome: true, usersHome: true },
    needsSync: false
  }
];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = String(init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  requests.push({ method, url, apiKey: headers.get('X-API-Key') ?? undefined, body: init?.body as string | undefined });

  if (url.endsWith('/api/v1/status')) return json({ version: '2026.7.22' });
  if (url.endsWith('/api/v1/settings/public')) return json({ initialized: true });
  if (url.endsWith('/api/v1/settings/plex/libraries')) {
    return json([
      { key: '2', name: 'Movies', type: 'movie' },
      { key: '3', name: 'TV Shows', type: 'show' }
    ]);
  }
  if (url.endsWith('/api/v1/settings/plex')) return json({ name: 'Family Plex' });
  if (url.endsWith('/api/v1/collections')) {
    return json({ collectionConfigs: collections });
  }
  if (url.endsWith('/api/v1/collections/create') && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const libraryIds = Array.isArray(body.libraryIds) ? body.libraryIds : [body.libraryId];
    for (const libraryId of libraryIds) {
      collections.push({
        ...body,
        id: 10012 + collections.length,
        libraryId,
        libraryName: libraryId === '2' ? 'Movies' : 'TV Shows',
        mediaType: libraryId === '2' ? 'movie' : 'tv'
      });
    }
    return json({ created: libraryIds.length });
  }
  const settingsMatch = url.match(/\/api\/v1\/collections\/(\d+)\/settings$/);
  if (settingsMatch && method === 'PUT') {
    const index = collections.findIndex((item) => String(item.id) === settingsMatch[1]);
    collections[index] = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return json({ updated: true });
  }
  if (url.endsWith('/api/v1/preexisting')) return json([]);
  if (url.endsWith('/api/v1/defaulthubs')) {
    return json([
      {
        id: 10065,
        name: 'Recently Added Movies',
        libraryId: '2',
        sortOrderHome: 1,
        randomizeHomeOrder: false,
        visibilityConfig: { serverOwnerHome: true, usersHome: true }
      }
    ]);
  }
  if (url.endsWith('/api/v1/collections/sync/status')) return json({ running: false, completed: true });

  if (url.endsWith('/api/v1/settings/jobs') && method === 'GET') {
    return json([
      {
        id: 'plex-randomize-home-order',
        name: 'Plex Randomize Home Order',
        cronSchedule: '0 0 6 * * *',
        running: false
      }
    ]);
  }
  if (url.endsWith('/api/v1/collections/10012/sync') && method === 'POST') return json({ message: 'started' });
  if (/\/api\/v1\/collections\/\d+\/sync$/.test(url) && method === 'POST') return json({ message: 'started' });
  if (url.endsWith('/api/v1/settings/jobs/plex-randomize-home-order/run') && method === 'POST') {
    return json({ message: 'started' });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

try {
  const {
    getAgregarrCollectionAction,
    getAgregarrHomeOrderAction,
    getAgregarrManagerAction,
    getAgregarrOverviewAction,
    getMcpToolCatalog,
    getToolServiceRequirement,
    runAgregarrJobAction,
    ensureAgregarrCollectionPresetAction,
    syncAgregarrCollectionGroupAction,
    syncAgregarrCollectionAction,
    updateAgregarrCollectionGroupAction,
    writeEnvConfig
  } = await import('@stackarr/core');
  writeEnvConfig({
    ENABLE_AGREGARR: 'true',
    AGREGARR_URL: 'http://mock-agregarr.invalid',
    AGREGARR_API_KEY: 'agregarr-test-key'
  });

  const overview = await getAgregarrOverviewAction();
  assert.equal(overview.counts.managedCollections, 1);
  assert.equal(overview.collections[0]?.name, 'Coming Soon');
  assert.equal(overview.jobs[0]?.cronSchedule, '0 0 6 * * *');
  assert.equal(JSON.stringify(overview).includes('agregarr-test-key'), false);

  const collection = await getAgregarrCollectionAction({ collectionId: '10012' });
  assert.equal(collection.collection.id, '10012');
  assert.equal(collection.syncStatus.completed, true);
  assert.equal(
    requests.some((request) => request.url.includes('/collections/10012/sync-status')),
    false
  );

  const home = await getAgregarrHomeOrderAction();
  assert.deepEqual(
    home.libraries[0]?.rows.map((row) => row.name),
    ['Recently Added Movies', 'Coming Soon']
  );
  assert.equal(home.libraries[0]?.rows[0]?.fixed, true);

  const manager = await getAgregarrManagerAction();
  assert.equal(manager.ready, true);
  assert.equal(manager.plexServerName, 'Family Plex');

  const linked = await ensureAgregarrCollectionPresetAction({
    preset: 'coming-soon',
    mediaScope: 'both',
    maxItems: 100,
    daysAhead: 730
  });
  const comingSoon = linked.groups.find((group) => group.type === 'comingsoon');
  assert.equal(comingSoon?.libraries.length, 2);
  assert.equal(comingSoon?.sortOrder, 'release_date_asc');
  assert.equal(
    requests.some(
      (request) =>
        request.url.endsWith('/api/v1/collections/create') &&
        request.body?.includes('"libraryId":"3"') &&
        request.body.includes('"createPlaceholdersForMissing":true')
    ),
    true
  );

  await updateAgregarrCollectionGroupAction({ collectionIds: comingSoon?.ids ?? [], showOnHome: false });
  assert.equal(
    collections.every((item) => (item.visibilityConfig as { usersHome?: boolean }).usersHome === false),
    true
  );
  await assert.rejects(
    updateAgregarrCollectionGroupAction({ collectionIds: comingSoon?.ids ?? [] }),
    /at least one Agregarr collection group setting/
  );

  await syncAgregarrCollectionGroupAction({ collectionIds: comingSoon?.ids ?? [] });

  await syncAgregarrCollectionAction({ collectionId: '10012' });
  await runAgregarrJobAction({ job: 'randomize-home-order' });

  await assert.rejects(syncAgregarrCollectionAction({ collectionId: '../settings' }), /numeric Agregarr collection id/);
  await assert.rejects(
    runAgregarrJobAction({ job: 'unsafe' as 'full-sync' }),
    /full-sync, quick-sync, or randomize-home-order/
  );

  const authenticatedRequests = requests.filter(
    (request) => !request.url.endsWith('/api/v1/status') && !request.url.endsWith('/api/v1/settings/public')
  );
  assert.equal(
    authenticatedRequests.every((request) => request.apiKey === 'agregarr-test-key'),
    true
  );
  assert.equal(
    requests.some(
      (request) =>
        request.url.endsWith('/api/v1/settings/jobs/plex-randomize-home-order/run') && request.body === undefined
    ),
    true
  );

  const enabled = new Set(['stackarr', 'agregarr']);
  const catalog = getMcpToolCatalog({ profile: 'manage', enabledServices: enabled });
  assert.equal(
    catalog.some((tool: { name: string }) => tool.name === 'stackarr_get_agregarr_overview'),
    true
  );
  assert.equal(
    catalog.some((tool: { name: string }) => tool.name === 'stackarr_sync_agregarr_collection'),
    true
  );
  assert.equal(
    catalog.some((tool: { name: string }) => tool.name === 'stackarr_ensure_agregarr_collection_preset'),
    true
  );
  assert.equal(
    catalog.some((tool: { name: string }) => tool.name === 'stackarr_sync_agregarr_collection_group'),
    true
  );
  assert.equal(
    catalog.some((tool: { name: string }) => tool.name === 'stackarr_update_agregarr_collection_group'),
    true
  );
  const overviewTool = catalog.find((tool: { name: string }) => tool.name === 'stackarr_get_agregarr_overview');
  assert.deepEqual(overviewTool ? getToolServiceRequirement(overviewTool) : undefined, { allOf: ['agregarr'] });

  console.log('agregarr MCP tests passed');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(tempRoot, { recursive: true, force: true });
}
