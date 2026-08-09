import { createHash } from 'node:crypto';
import { requestJson, ServiceApiError, withQuery } from '../clients/http';
import { serviceBaseUrl } from '../clients/serviceConfig';
import { readEnv } from '../env';

type JsonRecord = Record<string, unknown>;
type YoutarrRequestOptions = { method?: 'GET' | 'POST'; body?: unknown; useApiKey?: boolean };

let tokenCache: { signature: string; token: string } | undefined;

export async function getYoutarrHealthAction() {
  const baseUrl = serviceBaseUrl('youtarr');
  const [app, database] = await Promise.all([
    requestJson<unknown>(`${baseUrl}/api/health`),
    requestJson<unknown>(`${baseUrl}/api/db-status`)
  ]);

  return { app: jsonRecord(app), database: jsonRecord(database) };
}

export async function getYoutarrVideosAction(input: { page?: number; limit?: number; search?: string } = {}) {
  const page = boundedInteger(input.page ?? 1, 1, 100_000, 'page');
  const limit = boundedInteger(input.limit ?? 20, 1, 50, 'limit');
  const search = input.search ? boundedText(input.search, 200, 'search') : undefined;
  const response = jsonRecord(
    await youtarrRequest<unknown>(withQuery(`${serviceBaseUrl('youtarr')}/getVideos`, { page, limit, search }))
  );
  const videos = recordArray(response.videos ?? response.items ?? response.data).slice(0, limit);

  return {
    page,
    limit,
    total: numberValue(response.total) ?? numberValue(response.totalItems) ?? videos.length,
    videos: videos.map(summarizeVideo)
  };
}

export async function queueYoutarrDownloadAction(input: {
  url: string;
  resolution?: '360' | '480' | '720' | '1080' | '1440' | '2160';
  subfolder?: string;
}) {
  const url = validSingleYoutubeUrl(input.url);
  const subfolder = input.subfolder ? validSubfolder(input.subfolder) : undefined;
  const response = jsonRecord(
    await youtarrRequest<unknown>(`${serviceBaseUrl('youtarr')}/api/videos/download`, {
      method: 'POST',
      body: { url, ...(input.resolution ? { resolution: input.resolution } : {}), ...(subfolder ? { subfolder } : {}) },
      useApiKey: true
    })
  );
  const video = jsonRecord(response.video);

  return {
    queued: response.success !== false,
    message: stringValue(response.message),
    video: {
      title: stringValue(video.title),
      duration: numberValue(video.duration)
    }
  };
}

async function youtarrRequest<T>(url: string, options: YoutarrRequestOptions = {}, retry = true): Promise<T> {
  const env = readEnv();
  const authEnabled = env.YOUTARR_LOGIN_ENABLED?.toLowerCase() !== 'false';
  const apiKey = authEnabled && options.useApiKey ? env.YOUTARR_API_KEY?.trim() : undefined;
  const token = authEnabled && !apiKey ? await youtarrToken() : undefined;

  try {
    return await requestJson<T>(url, {
      method: options.method ?? 'GET',
      headers: apiKey ? { 'x-api-key': apiKey } : token ? { 'x-access-token': token } : undefined,
      body: options.body,
      timeoutMs: options.method === 'POST' ? 45_000 : 20_000
    });
  } catch (error) {
    if (authEnabled && !apiKey && retry && error instanceof ServiceApiError && [401, 403].includes(error.status ?? 0)) {
      tokenCache = undefined;
      return youtarrRequest<T>(url, options, false);
    }
    throw error;
  }
}

async function youtarrToken() {
  const env = readEnv();
  const username = env.YOUTARR_ADMIN_USERNAME?.trim() || env.USERNAME?.trim();
  const password = env.YOUTARR_ADMIN_PASSWORD?.trim() || env.PASSWORD?.trim();
  if (!username || !password) {
    throw new Error(
      'Youtarr MCP actions require YOUTARR_ADMIN_USERNAME and YOUTARR_ADMIN_PASSWORD or shared Stackarr credentials.'
    );
  }

  const signature = createHash('sha256')
    .update(`${serviceBaseUrl('youtarr')}\0${username}\0${password}`)
    .digest('hex');
  if (tokenCache?.signature === signature) return tokenCache.token;

  const auth = jsonRecord(
    await requestJson<unknown>(`${serviceBaseUrl('youtarr')}/auth/login`, {
      method: 'POST',
      body: { username, password },
      timeoutMs: 15_000
    })
  );
  const token = stringValue(auth.token);
  if (!token) throw new Error('Youtarr login succeeded without returning a token.');
  tokenCache = { signature, token };
  return token;
}

function summarizeVideo(item: JsonRecord) {
  return {
    id: scalarId(item.id),
    youtubeId: stringValue(item.youtube_id) ?? stringValue(item.youtubeId),
    title: stringValue(item.youTubeVideoName) ?? stringValue(item.title),
    channel:
      stringValue(item.youTubeChannelName) ??
      stringValue(item.channel_name) ??
      stringValue(item.channelName) ??
      stringValue(item.author),
    publishedAt:
      stringValue(item.originalDate) ??
      stringValue(item.published_at) ??
      stringValue(item.publishedAt) ??
      stringValue(item.upload_date),
    addedAt: stringValue(item.timeCreated) ?? stringValue(item.created_at) ?? stringValue(item.added),
    duration: numberValue(item.duration),
    resolution: stringValue(item.video_resolution),
    fileMissing:
      item.removed === true ||
      item.removed === 1 ||
      item.removed === '1' ||
      item.file_missing === true ||
      item.fileMissing === true,
    protected: item.protected === true || item.protected === 1 || item.protected === '1'
  };
}

function validSingleYoutubeUrl(value: string) {
  const text = boundedText(value, 2048, 'url');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('url must be a valid YouTube video URL.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const videoId = host === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] : youtubeVideoId(url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host) ||
    !/^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')
  ) {
    throw new Error('url must identify one YouTube video. Playlists and channel URLs are not accepted.');
  }
  if (url.searchParams.has('list')) throw new Error('url must not include a YouTube playlist.');
  return url.toString();
}

function youtubeVideoId(url: URL) {
  if (url.pathname === '/watch') return url.searchParams.get('v') ?? undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[0] === 'shorts' ? parts[1] : undefined;
}

function validSubfolder(value: string) {
  const text = boundedText(value, 128, 'subfolder');
  if (
    text === '.' ||
    text === '..' ||
    text.includes('/') ||
    text.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(text)
  ) {
    throw new Error('subfolder must be one folder name without path separators.');
  }
  return text;
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

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function scalarId(value: unknown) {
  return stringValue(value) ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined);
}
