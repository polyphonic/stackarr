import { createHash } from 'node:crypto';
import { requestJson, ServiceApiError, withQuery } from '../clients/http';
import { serviceBaseUrl } from '../clients/serviceConfig';
import { readEnv } from '../env';

type JsonRecord = Record<string, unknown>;
type QuestarrRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
};

let tokenCache: { signature: string; token: string } | undefined;

export async function searchQuestarrGamesAction(input: { query: string; limit?: number }) {
  const query = boundedText(input.query, 200, 'query');
  const limit = boundedInteger(input.limit ?? 10, 1, 20, 'limit');
  const response = await questarrRequest<unknown>(
    withQuery(`${serviceBaseUrl('questarr')}/api/igdb/search`, { q: query, limit })
  );

  return {
    query,
    results: recordArray(response).slice(0, limit).map(summarizeGame)
  };
}

export async function searchQuestarrReleasesAction(input: { query: string; limit?: number }) {
  const query = boundedText(input.query, 200, 'query');
  const limit = boundedInteger(input.limit ?? 10, 1, 25, 'limit');
  const response = jsonRecord(
    await questarrRequest<unknown>(withQuery(`${serviceBaseUrl('questarr')}/api/search`, { query, limit }))
  );

  return {
    query,
    total: numberValue(response.total) ?? 0,
    errors: arrayLength(response.errors),
    results: recordArray(response.items).slice(0, limit).map(summarizeRelease)
  };
}

export async function getQuestarrDownloadsAction(input: { limit?: number } = {}) {
  const limit = boundedInteger(input.limit ?? 20, 1, 50, 'limit');
  const response = jsonRecord(await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/downloads`));

  return {
    total: recordArray(response.downloads).length,
    errors: arrayLength(response.errors),
    downloads: recordArray(response.downloads).slice(0, limit).map(summarizeDownload)
  };
}

export async function startQuestarrDownloadAction(input: {
  query: string;
  releaseTitle: string;
  indexerName?: string;
  gameId?: string;
  downloadType?: 'main' | 'update' | 'dlc' | 'extra';
}) {
  const query = boundedText(input.query, 200, 'query');
  const releaseTitle = boundedText(input.releaseTitle, 500, 'releaseTitle');
  const indexerName = input.indexerName ? boundedText(input.indexerName, 200, 'indexerName') : undefined;
  const gameId = input.gameId ? validUuid(input.gameId, 'gameId') : undefined;
  const response = jsonRecord(
    await questarrRequest<unknown>(withQuery(`${serviceBaseUrl('questarr')}/api/search`, { query, limit: 100 }))
  );
  const matches = recordArray(response.items).filter((item) => {
    const titleMatches = normalized(stringValue(item.title)) === normalized(releaseTitle);
    const indexerMatches = !indexerName || normalized(stringValue(item.indexerName)) === normalized(indexerName);
    return titleMatches && indexerMatches;
  });

  if (!matches.length) {
    throw new Error(
      'Questarr could not find that exact release. Search again and use the returned title and indexer name.'
    );
  }
  if (matches.length > 1 && !indexerName) {
    const indexers = [...new Set(matches.map((item) => stringValue(item.indexerName)).filter(Boolean))];
    throw new Error(`Multiple Questarr releases have that title; provide indexerName (${indexers.join(', ')}).`);
  }

  const release = matches[0];
  const url = stringValue(release.link);
  if (!url || !/^(?:https?:\/\/|magnet:\?)/i.test(url)) {
    throw new Error('Questarr returned a release without a usable download link.');
  }

  const result = jsonRecord(
    await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/downloads`, {
      method: 'POST',
      body: {
        url,
        title: releaseTitle,
        ...(gameId ? { gameId } : {}),
        ...(input.downloadType ? { downloadType: input.downloadType } : {})
      }
    })
  );

  return {
    started: result.success !== false,
    title: releaseTitle,
    indexerName: stringValue(release.indexerName),
    downloaderId: stringValue(result.downloaderId),
    downloadId: scalarId(result.id),
    message: stringValue(result.message)
  };
}

export async function questarrRequest<T>(url: string, options: QuestarrRequestOptions = {}, retry = true): Promise<T> {
  const token = await questarrToken();
  try {
    return await requestJson<T>(url, {
      method: options.method ?? 'GET',
      headers: { authorization: `Bearer ${token}` },
      body: options.body,
      timeoutMs: options.method && options.method !== 'GET' ? 30_000 : url.includes('/api/search') ? 60_000 : 20_000
    });
  } catch (error) {
    if (retry && error instanceof ServiceApiError && error.status === 401) {
      tokenCache = undefined;
      return questarrRequest<T>(url, options, false);
    }
    throw error;
  }
}

async function questarrToken() {
  const env = readEnv();
  const username = env.USERNAME?.trim();
  const password = env.PASSWORD?.trim();
  if (!username || !password) {
    throw new Error('Questarr MCP actions require Stackarr USERNAME and PASSWORD runtime credentials.');
  }

  const signature = createHash('sha256')
    .update(`${serviceBaseUrl('questarr')}\0${username}\0${password}`)
    .digest('hex');
  if (tokenCache?.signature === signature) return tokenCache.token;

  const auth = jsonRecord(
    await requestJson<unknown>(`${serviceBaseUrl('questarr')}/api/auth/login`, {
      method: 'POST',
      body: { username, password },
      timeoutMs: 15_000
    })
  );
  const token = stringValue(auth.token);
  if (!token) throw new Error('Questarr login succeeded without returning a token.');
  tokenCache = { signature, token };
  return token;
}

function summarizeGame(item: JsonRecord) {
  return {
    igdbId: numberValue(item.igdbId) ?? numberValue(item.id),
    title: stringValue(item.title) ?? stringValue(item.name),
    releaseDate: stringValue(item.releaseDate) ?? stringValue(item.firstReleaseDate),
    rating: numberValue(item.rating),
    platforms: stringList(item.platforms),
    genres: stringList(item.genres)
  };
}

function summarizeRelease(item: JsonRecord) {
  return {
    title: stringValue(item.title),
    indexerName: stringValue(item.indexerName),
    protocol: stringValue(item.protocol),
    publishedAt: stringValue(item.pubDate),
    size: numberValue(item.size),
    seeders: numberValue(item.seeders),
    leechers: numberValue(item.leechers),
    category: stringValue(item.category)
  };
}

function summarizeDownload(item: JsonRecord) {
  return {
    id: stringValue(item.id) ?? stringValue(item.hash),
    title: stringValue(item.title) ?? stringValue(item.name),
    status: stringValue(item.status),
    progress: numberValue(item.progress),
    size: numberValue(item.size),
    downloadSpeed: numberValue(item.downloadSpeed) ?? numberValue(item.dlspeed),
    eta: numberValue(item.eta),
    downloaderName: stringValue(item.downloaderName),
    trackedByQuestarr: item.trackedByQuestarr === true
  };
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object')
    : [];
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function scalarId(value: unknown) {
  return stringValue(value) ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined);
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item : stringValue(jsonRecord(item).name)))
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
}

function boundedText(value: string, max: number, name: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw new Error(`${name} must contain between 1 and ${max} characters.`);
  return text;
}

function boundedInteger(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function validUuid(value: string, name: string) {
  const normalizedValue = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedValue)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return normalizedValue;
}

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}
