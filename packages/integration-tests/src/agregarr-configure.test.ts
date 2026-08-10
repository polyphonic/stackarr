import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const configureScript = path.join(repoRoot, 'stackarr/scripts/agregarr-configure.py');

test('Agregarr configuration promotes New Movies and New Episodes while preserving Recently Added', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-agregarr-configure-'));
  const settingsPath = path.join(root, 'settings.json');
  const keyOutput = path.join(root, 'api-key');
  await writeFile(settingsPath, JSON.stringify({ main: { apiKey: 'agregarr-fixture-key' } }));

  const collections: Array<Record<string, any>> = [
    fixtureCollection(101, 'Recently Added Movies', 'recently_added', '2', 'Movies', 'movie', 1),
    fixtureCollection(102, 'Coming Soon', 'monitored', '2', 'Movies', 'movie', 2, 'comingsoon'),
    fixtureCollection(103, 'Recently Released Movies', 'recently_released', '2', 'Movies', 'movie', 22),
    fixtureCollection(201, 'Recently Added TV', 'recently_added', '3', 'TV Shows', 'tv', 1),
    fixtureCollection(202, 'Coming Soon', 'monitored', '3', 'TV Shows', 'tv', 2, 'comingsoon'),
    fixtureCollection(203, 'Recently Released Episodes', 'recently_released_episodes', '3', 'TV Shows', 'tv', 4)
  ];
  const defaultHubs: Array<Record<string, any>> = [
    fixtureHub(301, 'Recently Added Movies', 'movie.recentlyadded', '2', 'Movies'),
    fixtureHub(302, 'Recently Released Movies', 'movie.recentlyreleased', '2', 'Movies'),
    fixtureHub(401, 'Recently Added TV', 'tv.recentlyadded', '3', 'TV Shows'),
    fixtureHub(402, 'Recently Released Episodes', 'tv.recentlyaired', '3', 'TV Shows')
  ];
  const reorders: Array<Record<string, any>> = [];
  const plexRenames: Array<{ libraryId: string; ratingKey: string; title: string }> = [];
  const plexFallbackRenames: Array<{ ratingKey: string; title: string }> = [];
  const plexHubRefreshes: string[] = [];
  const plexHubMoves: string[] = [];
  const plexTitles = new Map([
    ['plex-103', 'New Releases'],
    ['plex-203', 'Recently Released Episodes']
  ]);
  const plexHubTitles = new Map([
    ['plex-103', 'New Releases'],
    ['plex-203', 'Recently Released Episodes']
  ]);
  let tvSort = 'originallyAvailableAt:desc';

  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, any>) : {};
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const requestPath = url.pathname;

    response.setHeader('content-type', 'application/json');
    const collectionSettings = requestPath.match(/^\/api\/v1\/collections\/(\d+)\/settings$/);
    const hubSettings = requestPath.match(/^\/api\/v1\/defaulthubs\/(\d+)\/settings$/);
    const plexRename = requestPath.match(/^\/library\/sections\/(\d+)\/all$/);
    const plexMetadata = requestPath.match(/^\/library\/metadata\/plex-(\d+)$/);
    const plexHubItem = requestPath.match(/^\/hubs\/sections\/(\d+)\/manage\/custom\.collection\.(\d+)\.(plex-\d+)$/);
    const plexHubMove = requestPath.match(
      /^\/hubs\/sections\/(\d+)\/manage\/custom\.collection\.(\d+)\.(plex-\d+)\/move$/
    );
    const plexHubPromote = requestPath.match(/^\/hubs\/sections\/(\d+)\/manage$/);
    if (plexMetadata && request.method === 'GET') {
      const title = plexTitles.get(`plex-${plexMetadata[1]}`) || '';
      const sort = plexMetadata[1] === '203' ? tvSort : 'originallyAvailableAt:desc';
      const content = `/library/sections/${plexMetadata[1] === '203' ? '3' : '2'}/all?type=${plexMetadata[1] === '203' ? '2' : '1'}&sort=${sort}&limit=30`;
      response.setHeader('content-type', 'application/xml');
      response.end(
        `<MediaContainer><Directory title="${title}" content="${content.replaceAll('&', '&amp;')}" /></MediaContainer>`
      );
    } else if (plexMetadata && request.method === 'PUT') {
      const ratingKey = `plex-${plexMetadata[1]}`;
      const title = url.searchParams.get('title.value') || '';
      plexFallbackRenames.push({ ratingKey, title });
      plexTitles.set(ratingKey, title);
      response.end('{}');
    } else if (plexRename && request.method === 'PUT') {
      const ratingKey = url.searchParams.get('id') || '';
      const title = url.searchParams.get('title.value') || '';
      plexRenames.push({
        libraryId: plexRename[1] || '',
        ratingKey,
        title
      });
      if (plexRename[1] === '3') {
        response.statusCode = 409;
        response.end('<h1>409 Conflict</h1>');
      } else {
        plexTitles.set(ratingKey, title);
        response.end('{}');
      }
    } else if (plexHubItem && request.method === 'DELETE') {
      plexHubRefreshes.push(`delete:${plexHubItem[1]}:${plexHubItem[3]}`);
      plexHubTitles.delete(plexHubItem[3] || '');
      response.end('{}');
    } else if (plexHubPromote && request.method === 'POST') {
      const ratingKey = url.searchParams.get('metadataItemId') || '';
      plexHubRefreshes.push(`promote:${plexHubPromote[1]}:${ratingKey}`);
      plexHubTitles.set(ratingKey, plexTitles.get(ratingKey) || '');
      response.end('{}');
    } else if (plexHubMove && request.method === 'PUT') {
      plexHubMoves.push(`${plexHubMove[1]}:${plexHubMove[3]}`);
      response.end('{}');
    } else if (plexHubItem && request.method === 'PUT') {
      assert.equal(url.searchParams.get('promotedToRecommended'), '1');
      assert.equal(url.searchParams.get('promotedToOwnHome'), '1');
      assert.equal(url.searchParams.get('promotedToSharedHome'), '1');
      plexHubRefreshes.push(`visible:${plexHubItem[1]}:${plexHubItem[3]}`);
      response.end('{}');
    } else if (requestPath === '/api/v1/settings/plex' && request.method === 'GET') response.end('{}');
    else if (requestPath === '/api/v1/settings/plex/libraries') {
      response.end(
        JSON.stringify([
          { key: '2', name: 'Movies', type: 'movie' },
          { key: '3', name: 'TV Shows', type: 'show' }
        ])
      );
    } else if (requestPath === '/api/v1/settings/main' && request.method === 'GET') response.end('{}');
    else if (requestPath === '/api/v1/collections' && request.method === 'GET') {
      response.end(JSON.stringify({ collectionConfigs: collections }));
    } else if (requestPath === '/api/v1/defaulthubs' && request.method === 'GET') {
      response.end(JSON.stringify(defaultHubs));
    } else if (requestPath === '/api/v1/preexisting' && request.method === 'GET') response.end('[]');
    else if (collectionSettings && request.method === 'PUT') {
      const index = collections.findIndex((item) => String(item.id) === collectionSettings[1]);
      assert.notEqual(index, -1);
      collections[index] = body;
      response.end(JSON.stringify({ updated: true }));
    } else if (hubSettings && request.method === 'PUT') {
      const index = defaultHubs.findIndex((item) => String(item.id) === hubSettings[1]);
      assert.notEqual(index, -1);
      defaultHubs[index] = body;
      response.end(JSON.stringify({ updated: true }));
    } else if (requestPath === '/api/v1/reorder' && request.method === 'POST') {
      for (const [index, item] of (body.mixedItems as Array<Record<string, unknown>>).entries()) {
        assert.equal(item.position, index, 'Agregarr requires a zero-based position on every mixed reorder row');
      }
      reorders.push(body);
      const field = body.context === 'library' ? 'sortOrderLibrary' : 'sortOrderHome';
      for (const [index, item] of (body.mixedItems as Array<Record<string, unknown>>).entries()) {
        const collectionIndex = collections.findIndex((candidate) => candidate.id === item.id);
        if (collectionIndex !== -1)
          collections[collectionIndex] = { ...collections[collectionIndex], ...item, [field]: index + 1 };
      }
      response.end(JSON.stringify({ updated: true }));
    } else if (
      requestPath === '/api/v1/auth/plex' ||
      requestPath === '/api/v1/settings/plex' ||
      requestPath === '/api/v1/settings/main' ||
      requestPath === '/api/v1/settings/initialize' ||
      requestPath === '/api/v1/discovery/hubs/scan' ||
      requestPath === '/api/v1/settings/jobs/plex-collections-sync/run' ||
      requestPath === '/api/v1/settings/plex/library'
    ) {
      response.end('{}');
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: `not found: ${request.method} ${request.url}` }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const runConfigure = () =>
      execFile('python3', [configureScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          AGREGARR_URL: `http://127.0.0.1:${address.port}`,
          PLEX_URL: `http://127.0.0.1:${address.port}`,
          AGREGARR_SETTINGS_PATH: settingsPath,
          AGREGARR_KEY_OUTPUT: keyOutput,
          AGREGARR_BROWSER_URL: 'https://agregarr.stack',
          PLEX_TOKEN: 'plex-fixture-token',
          ENABLE_MOVIES: 'true',
          ENABLE_TV_SHOWS: 'true'
        }
      });

    await assert.rejects(runConfigure(), /New Episodes.*episode\.originallyAvailableAt:desc/);
    tvSort = 'episode.originallyAvailableAt:desc';
    reorders.length = 0;
    plexHubMoves.length = 0;
    const { stdout } = await runConfigure();

    assert.match(stdout, /2 newest-release collections/);
    for (const [id, expectedName] of [
      [103, 'New Movies'],
      [203, 'New Episodes']
    ] as const) {
      const release = collections.find((item) => item.id === id);
      assert.equal(release?.name, expectedName);
      assert.equal(release?.template, expectedName);
      assert.equal(release?.subtype, 'recently_released');
      assert.equal(release?.maxItems, 30);
      assert.equal(release?.sortOrderHome, 1);
      assert.equal(release?.randomizeHomeOrder, false);
      assert.deepEqual(release?.visibilityConfig, {
        usersHome: true,
        serverOwnerHome: true,
        libraryRecommended: true
      });
    }

    assert.equal(collections.find((item) => item.id === 101)?.name, 'Recently Added Movies');
    assert.equal(collections.find((item) => item.id === 101)?.subtype, 'recently_added');
    assert.equal(collections.find((item) => item.id === 201)?.name, 'Recently Added TV');
    assert.equal(collections.find((item) => item.id === 201)?.subtype, 'recently_added');
    assert.deepEqual(plexRenames, [
      { libraryId: '2', ratingKey: 'plex-103', title: 'New Movies' },
      { libraryId: '3', ratingKey: 'plex-203', title: 'New Episodes' }
    ]);
    assert.deepEqual(plexFallbackRenames, [{ ratingKey: 'plex-203', title: 'New Episodes' }]);
    assert.equal(plexTitles.get('plex-103'), 'New Movies');
    assert.equal(plexTitles.get('plex-203'), 'New Episodes');
    assert.equal(plexHubTitles.get('plex-103'), 'New Movies');
    assert.equal(plexHubTitles.get('plex-203'), 'New Episodes');
    assert.deepEqual(plexHubRefreshes, [
      'delete:2:plex-103',
      'promote:2:plex-103',
      'visible:2:plex-103',
      'delete:3:plex-203',
      'promote:3:plex-203',
      'visible:3:plex-203'
    ]);
    assert.deepEqual(plexHubMoves, ['2:plex-103', '3:plex-203']);

    assert.equal(reorders.length, 4);
    assert.deepEqual(
      reorders
        .filter((reorder) => reorder.context === 'home')
        .map((reorder) => (reorder.mixedItems as Array<Record<string, unknown>>).slice(0, 3).map((item) => item.id)),
      [
        [103, 101, 102],
        [203, 201, 202]
      ]
    );
    assert.deepEqual(
      reorders
        .filter((reorder) => reorder.context === 'library')
        .map((reorder) => (reorder.mixedItems as Array<Record<string, unknown>>)[0]?.id),
      [103, 203]
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  }
});

function fixtureCollection(
  id: number,
  name: string,
  subtype: string,
  libraryId: string,
  libraryName: string,
  mediaType: string,
  sortOrderHome: number,
  type = 'filtered_hub'
) {
  return {
    id,
    name,
    template: name,
    type,
    subtype,
    libraryId,
    libraryName,
    mediaType,
    maxItems: 20,
    sortOrderHome,
    sortOrderLibrary: sortOrderHome,
    isLibraryPromoted: true,
    collectionRatingKey: `plex-${id}`,
    randomizeHomeOrder: false,
    visibilityConfig: { usersHome: name.startsWith('Recently Added') || name === 'Coming Soon' }
  };
}

function fixtureHub(id: number, name: string, hubIdentifier: string, libraryId: string, libraryName: string) {
  return {
    id,
    name,
    hubIdentifier,
    libraryId,
    libraryName,
    visibilityConfig: { usersHome: false, serverOwnerHome: false, libraryRecommended: false }
  };
}
