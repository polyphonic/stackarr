#!/usr/bin/env node

const baseUrl = `http://127.0.0.1:${process.env.QUESTARR_WEB_PORT || '7584'}`;

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

  const sync = await request('/api/indexers/prowlarr/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: 'http://prowlarr:9696', apiKey: prowlarrKey })
  });

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

  const added = sync.results?.added ?? 0;
  const updated = sync.results?.updated ?? 0;
  process.stdout.write(
    `Questarr configured: account ${auth.created ? 'created' : 'verified'}, Prowlarr indexers ${added} added/${updated} updated, ${config.name} connected.\n`
  );
  process.stdout.write(
    'RomM library import and Questarr post-processing remain disabled until explicitly configured.\n'
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
