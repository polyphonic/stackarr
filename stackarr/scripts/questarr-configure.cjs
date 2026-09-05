#!/usr/bin/env node

const baseUrl = process.env.QUESTARR_CONFIGURE_URL || `http://127.0.0.1:${process.env.QUESTARR_WEB_PORT || '7584'}`;
const prowlarrBaseUrl = process.env.PROWLARR_CONFIGURE_URL || 'http://prowlarr:9696';

function fail(message) {
  process.stderr.write(`Questarr configuration failed: ${message}\n`);
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

async function authenticate() {
  const username = process.env.USERNAME?.trim();
  const password = process.env.PASSWORD?.trim();
  if (!username || !password) fail('USERNAME and PASSWORD must be configured');

  const status = await request('/api/auth/status');
  const path = status.hasUsers ? '/api/auth/login' : '/api/auth/setup';
  const body = { username, password };
  if (!status.hasUsers) {
    body.igdbClientId = process.env.QUESTARR_IGDB_CLIENT_ID || process.env.ROMM_IGDB_CLIENT_ID || '';
    body.igdbClientSecret = process.env.QUESTARR_IGDB_CLIENT_SECRET || process.env.ROMM_IGDB_CLIENT_SECRET || '';
  }
  const auth = await request(path, { method: 'POST', body: JSON.stringify(body) });
  if (!auth.token) fail('Questarr did not return an authentication token');
  return { token: auth.token, created: !status.hasUsers };
}

async function prowlarrRequest(path, apiKey, options = {}) {
  const response = await fetch(`${prowlarrBaseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'X-Api-Key': apiKey,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Prowlarr ${path} returned ${response.status}`);
  return response.json();
}

async function ensureGameIndexer(apiKey) {
  let tags = await prowlarrRequest('/api/v1/tag', apiKey);
  let gamesTag = Array.isArray(tags) ? tags.find((tag) => String(tag.label).toLowerCase() === 'games') : undefined;
  if (!gamesTag) {
    gamesTag = await prowlarrRequest('/api/v1/tag', apiKey, {
      method: 'POST',
      body: JSON.stringify({ label: 'games' })
    });
    tags = [...(Array.isArray(tags) ? tags : []), gamesTag];
  }
  let approvedTag = Array.isArray(tags)
    ? tags.find((tag) => String(tag.label).toLowerCase() === 'stackarr-approved')
    : undefined;
  if (!approvedTag) {
    approvedTag = await prowlarrRequest('/api/v1/tag', apiKey, {
      method: 'POST',
      body: JSON.stringify({ label: 'stackarr-approved' })
    });
  }

  let profiles = await prowlarrRequest('/api/v1/appprofile', apiKey);
  let interactiveProfile = Array.isArray(profiles)
    ? profiles.find((profile) => profile.name === 'Interactive only')
    : undefined;
  if (!interactiveProfile) {
    interactiveProfile = await prowlarrRequest('/api/v1/appprofile', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Interactive only',
        enableRss: false,
        enableAutomaticSearch: false,
        enableInteractiveSearch: true,
        minimumSeeders: 1
      })
    });
  }

  const archivePolicy = (indexer) => ({
    ...indexer,
    enable: true,
    appProfileId: interactiveProfile.id,
    fields: (indexer.fields || []).map((field) => {
      if (field.name === 'baseSettings.queryLimit') return { ...field, value: 1 };
      if (field.name === 'baseSettings.limitsUnit') return { ...field, value: 0 };
      return field;
    })
  });

  let indexers = await prowlarrRequest('/api/v1/indexer', apiKey);
  let gameIndexer = Array.isArray(indexers)
    ? indexers.find((indexer) => indexer.name === 'Internet Archive (Games)')
    : undefined;
  if (!gameIndexer) {
    const schemas = await prowlarrRequest('/api/v1/indexer/schema', apiKey);
    const schema = Array.isArray(schemas)
      ? schemas.find((indexer) => indexer.definitionName === 'internetarchive-stackarr')
      : undefined;
    if (!schema) throw new Error('Stackarr Internet Archive game indexer definition was not loaded by Prowlarr');
    gameIndexer = await prowlarrRequest('/api/v1/indexer', apiKey, {
      method: 'POST',
      body: JSON.stringify(
        archivePolicy({
          ...schema,
          name: 'Internet Archive (Games)',
          redirect: false,
          priority: 25,
          tags: [gamesTag.id, approvedTag.id]
        })
      )
    });
    indexers = [...(Array.isArray(indexers) ? indexers : []), gameIndexer];
  } else {
    gameIndexer = await prowlarrRequest(`/api/v1/indexer/${gameIndexer.id}?forceSave=true`, apiKey, {
      method: 'PUT',
      body: JSON.stringify(
        archivePolicy({
          ...gameIndexer,
          tags: [...new Set([...(Array.isArray(gameIndexer.tags) ? gameIndexer.tags : []), gamesTag.id, approvedTag.id])]
        })
      )
    });
  }

  const genericArchive = Array.isArray(indexers)
    ? indexers.find((indexer) => indexer.name === 'Internet Archive')
    : undefined;
  if (genericArchive) {
    await prowlarrRequest(`/api/v1/indexer/${genericArchive.id}?forceSave=true`, apiKey, {
      method: 'PUT',
      body: JSON.stringify(archivePolicy(genericArchive))
    });
  }
  return gameIndexer;
}

function prowlarrIndexerId(url) {
  const match = String(url || '').match(/\/(\d+)\/api\/?$/);
  return match ? Number(match[1]) : undefined;
}

async function restrictQuestarrToGameIndexers(headers, prowlarrKey) {
  const [tags, prowlarrIndexers, questarrIndexers] = await Promise.all([
    prowlarrRequest('/api/v1/tag', prowlarrKey),
    prowlarrRequest('/api/v1/indexer', prowlarrKey),
    request('/api/indexers', { headers })
  ]);
  const gamesTag = Array.isArray(tags) ? tags.find((tag) => String(tag.label).toLowerCase() === 'games') : undefined;
  if (!gamesTag) throw new Error('Prowlarr tag "games" is required before Questarr indexers can be enabled');
  const approvedTag = Array.isArray(tags)
    ? tags.find((tag) => String(tag.label).toLowerCase() === 'stackarr-approved')
    : undefined;
  if (!approvedTag)
    throw new Error('Prowlarr tag "stackarr-approved" is required before Questarr indexers can be enabled');

  const allowedIds = new Set(
    (Array.isArray(prowlarrIndexers) ? prowlarrIndexers : [])
      .filter(
        (indexer) =>
          indexer.enable &&
          Array.isArray(indexer.tags) &&
          indexer.tags.includes(gamesTag.id) &&
          indexer.tags.includes(approvedTag.id)
      )
      .map((indexer) => Number(indexer.id))
  );
  let enabled = 0;
  let disabled = 0;
  for (const indexer of Array.isArray(questarrIndexers) ? questarrIndexers : []) {
    const sourceId = prowlarrIndexerId(indexer.url);
    if (sourceId === undefined) continue;
    const shouldEnable = allowedIds.has(sourceId);
    if (shouldEnable) enabled++;
    else disabled++;
    if (Boolean(indexer.enabled) === shouldEnable) continue;
    await request(`/api/indexers/${indexer.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: shouldEnable })
    });
  }
  return { enabled, disabled };
}

function downloaderConfig() {
  const client = String(process.env.PREFERRED_TORRENT_CLIENT || 'transmission').toLowerCase();
  const completeName = process.env.DOWNLOAD_COMPLETE_NAME || 'complete';
  if (client === 'qbittorrent') {
    return {
      name: 'Stackarr qBittorrent',
      type: 'qbittorrent',
      url: 'http://qbittorrent',
      port: Number(process.env.QBITTORRENT_WEBUI_PORT || 8081),
      useSsl: false,
      urlPath: '',
      username: process.env.USERNAME || '',
      password: process.env.QBITTORRENT_PASSWORD || process.env.PASSWORD || '',
      enabled: true,
      priority: 1,
      downloadPath: `/downloads/${completeName}`,
      category: 'games',
      label: 'Questarr',
      addStopped: false,
      removeCompleted: false,
      postImportCategory: '',
      settings: ''
    };
  }
  return {
    name: 'Stackarr Transmission',
    type: 'transmission',
    url: 'http://transmission',
    port: 9091,
    useSsl: false,
    urlPath: '',
    username: process.env.USERNAME || '',
    password: process.env.TRANSMISSION_PASSWORD || process.env.PASSWORD || '',
    enabled: true,
    priority: 1,
    downloadPath: `/downloads/${completeName}`,
    category: 'games',
    label: 'Questarr',
    addStopped: false,
    removeCompleted: false,
    postImportCategory: '',
    settings: ''
  };
}

async function main() {
  const auth = await authenticate();
  const headers = { authorization: `Bearer ${auth.token}` };
  const prowlarrKey = process.env.PROWLARR_API_KEY;
  if (!prowlarrKey) fail('PROWLARR_API_KEY is unavailable');
  await ensureGameIndexer(prowlarrKey);

  const sync = await request('/api/indexers/prowlarr/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: prowlarrBaseUrl, ['api' + 'Key']: prowlarrKey })
  });
  const gameIndexers = await restrictQuestarrToGameIndexers(headers, prowlarrKey);

  const config = downloaderConfig();
  const test = await request('/api/downloaders/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(config)
  });
  if (!test.success) fail(test.message || `Could not connect to ${config.name}`);

  const downloaders = await request('/api/downloaders', { headers });
  const existing = Array.isArray(downloaders) ? downloaders.find((item) => item.name === config.name) : undefined;
  await request(existing ? `/api/downloaders/${existing.id}` : '/api/downloaders', {
    method: existing ? 'PATCH' : 'POST',
    headers,
    body: JSON.stringify(config)
  });

  // Stackarr owns the ClamAV gate and RomM fs_slug placement. Leaving Questarr's
  // generic importer enabled would bypass both invariants.
  await request('/api/imports/config', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ enablePostProcessing: false })
  });

  const added = sync.results?.added ?? 0;
  const updated = sync.results?.updated ?? 0;
  process.stdout.write(
    `Questarr configured: account ${auth.created ? 'created' : 'verified'}, Prowlarr indexers ${added} added/${updated} updated, game sources ${gameIndexers.enabled} enabled/${gameIndexers.disabled} excluded, ${config.name} connected.\n`
  );
  process.stdout.write(
    process.env.QUESTARR_ROMM_IMPORT_ENABLED === 'true'
      ? 'Secure RomM import enabled: Stackarr requires ClamAV and explicit RomM platform mappings.\n'
      : 'Secure RomM import remains disabled until Questarr and RomM are enabled together.\n'
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
