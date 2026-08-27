import { type Downloader, selectedDownloader, serviceBaseUrl } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { requireDeleteDataConfirmation } from '../safety/dangerous';

function client(input?: { downloader?: Downloader }) {
  return selectedDownloader(input?.downloader);
}

type DownloadItem = {
  id: string;
  name: string;
  status: string;
  progress: number;
  size?: number;
  etaSeconds?: number;
  rateDownload?: number;
  rateUpload?: number;
  addedDate?: string;
  completedDate?: string;
  error?: string;
};

type TransmissionRpcResponse<T = unknown> = {
  result: string;
  arguments?: T;
};

type TransmissionTorrent = {
  id: number;
  hashString?: string;
  name: string;
  status: number;
  percentDone: number;
  totalSize?: number;
  eta?: number;
  rateDownload?: number;
  rateUpload?: number;
  addedDate?: number;
  doneDate?: number;
  errorString?: string;
};

type QbittorrentTorrent = {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size?: number;
  eta?: number;
  dlspeed?: number;
  upspeed?: number;
  added_on?: number;
  completion_on?: number;
};

const transmissionFields = [
  'id',
  'hashString',
  'name',
  'status',
  'percentDone',
  'totalSize',
  'eta',
  'rateDownload',
  'rateUpload',
  'addedDate',
  'doneDate',
  'errorString'
];

export async function getTransmissionSessionStatus() {
  const response = await transmissionRpc<{ version?: string; 'rpc-version'?: number }>('session-get');
  return {
    version: response.arguments?.version,
    rpcVersion: response.arguments?.['rpc-version']
  };
}

export async function getDownloadQueueAction(input: { downloader?: Downloader } = {}) {
  const downloader = client(input);
  const items = downloader === 'transmission' ? await getTransmissionTorrents() : await getQbittorrentTorrents();
  return { downloader, items: items.filter((item) => item.progress < 1) };
}

export async function getDownloadHistoryAction(input: { downloader?: Downloader } = {}) {
  const downloader = client(input);
  const items = downloader === 'transmission' ? await getTransmissionTorrents() : await getQbittorrentTorrents();
  return { downloader, items: items.filter((item) => item.progress >= 1 || Boolean(item.completedDate)) };
}

export async function getStalledDownloadsAction(input: { downloader?: Downloader } = {}) {
  const downloader = client(input);
  const items = downloader === 'transmission' ? await getTransmissionTorrents() : await getQbittorrentTorrents();
  return {
    downloader,
    items: items.filter((item) => item.progress < 1 && isStalled(item))
  };
}

export async function addMagnetAction(input: { downloader?: Downloader; magnet: string }) {
  return addDownload(input, input.magnet);
}

export async function addTorrentUrlAction(input: { downloader?: Downloader; url: string }) {
  return addDownload(input, input.url);
}

export async function pauseDownloadAction(input: { downloader?: Downloader; id: string }) {
  const downloader = client(input);
  if (downloader === 'transmission') {
    await transmissionRpc('torrent-stop', { ids: [transmissionId(input.id)] });
  } else {
    await qbittorrentPost('torrents/pause', { hashes: input.id });
  }
  return { downloader, accepted: true, id: input.id, paused: true };
}

export async function resumeDownloadAction(input: { downloader?: Downloader; id: string }) {
  const downloader = client(input);
  if (downloader === 'transmission') {
    await transmissionRpc('torrent-start', { ids: [transmissionId(input.id)] });
  } else {
    await qbittorrentPost('torrents/resume', { hashes: input.id });
  }
  return { downloader, accepted: true, id: input.id, resumed: true };
}

export async function removeDownloadAction(input: {
  downloader?: Downloader;
  id: string;
  deleteData?: boolean;
  confirmDeleteData?: boolean;
}) {
  requireDeleteDataConfirmation(input);
  const downloader = client(input);
  if (downloader === 'transmission') {
    await transmissionRpc('torrent-remove', {
      ids: [transmissionId(input.id)],
      'delete-local-data': Boolean(input.deleteData)
    });
  } else {
    await qbittorrentPost('torrents/delete', { hashes: input.id, deleteFiles: Boolean(input.deleteData) });
  }
  return { downloader, accepted: true, id: input.id, deleteData: Boolean(input.deleteData), removed: true };
}

export async function setDownloadPriorityAction(input: { downloader?: Downloader; id: string; priority: number }) {
  const downloader = client(input);
  if (downloader === 'transmission') {
    await transmissionRpc('torrent-set', {
      ids: [transmissionId(input.id)],
      bandwidthPriority: clampPriority(input.priority)
    });
  } else {
    const endpoint = input.priority > 0 ? 'torrents/topPrio' : input.priority < 0 ? 'torrents/bottomPrio' : undefined;
    if (endpoint) await qbittorrentPost(endpoint, { hashes: input.id });
  }
  return { downloader, accepted: true, id: input.id, priority: input.priority };
}

async function addDownload(input: { downloader?: Downloader }, source: string) {
  const downloader = client(input);
  if (downloader === 'transmission') {
    const result = await transmissionRpc<{
      'torrent-added'?: { id: number; hashString?: string; name?: string };
      'torrent-duplicate'?: { id: number; hashString?: string; name?: string };
    }>('torrent-add', { filename: source });
    const torrent = result.arguments?.['torrent-added'] ?? result.arguments?.['torrent-duplicate'];
    return {
      downloader,
      accepted: true,
      duplicate: Boolean(result.arguments?.['torrent-duplicate']),
      id: torrent?.id !== undefined ? String(torrent.id) : undefined,
      hash: torrent?.hashString,
      name: torrent?.name
    };
  }

  await qbittorrentPost('torrents/add', { urls: source });
  return { downloader, accepted: true };
}

async function getTransmissionTorrents(): Promise<DownloadItem[]> {
  const response = await transmissionRpc<{ torrents: TransmissionTorrent[] }>('torrent-get', {
    fields: transmissionFields
  });
  return (response.arguments?.torrents ?? []).map((torrent) => ({
    id: String(torrent.id),
    name: torrent.name,
    status: transmissionStatus(torrent.status),
    progress: torrent.percentDone,
    size: torrent.totalSize,
    etaSeconds: torrent.eta !== undefined && torrent.eta >= 0 ? torrent.eta : undefined,
    rateDownload: torrent.rateDownload,
    rateUpload: torrent.rateUpload,
    addedDate: timestamp(torrent.addedDate),
    completedDate: timestamp(torrent.doneDate),
    error: torrent.errorString || undefined
  }));
}

async function getQbittorrentTorrents(): Promise<DownloadItem[]> {
  const torrents = await qbittorrentGet<QbittorrentTorrent[]>('torrents/info');
  return torrents.map((torrent) => ({
    id: torrent.hash,
    name: torrent.name,
    status: torrent.state,
    progress: torrent.progress,
    size: torrent.size,
    etaSeconds: torrent.eta !== undefined && torrent.eta >= 0 ? torrent.eta : undefined,
    rateDownload: torrent.dlspeed,
    rateUpload: torrent.upspeed,
    addedDate: timestamp(torrent.added_on),
    completedDate: timestamp(torrent.completion_on)
  }));
}

async function transmissionRpc<T = unknown>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<TransmissionRpcResponse<T>> {
  const url = transmissionRpcUrl();
  const headers = transmissionHeaders();
  const body = JSON.stringify({ method, arguments: args });
  let response = await fetch(url, { method: 'POST', headers, body });

  if (response.status === 409) {
    const sessionId = response.headers.get('x-transmission-session-id');
    if (!sessionId)
      throw new Error('Transmission requested a session retry without providing X-Transmission-Session-Id.');
    response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'x-transmission-session-id': sessionId },
      body
    });
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as TransmissionRpcResponse<T>) : { result: 'empty response' };
  if (!response.ok || data.result !== 'success') {
    throw new Error(`Transmission RPC ${method} failed: ${data.result || `HTTP ${response.status}`}`);
  }
  return data;
}

function transmissionHeaders() {
  const env = readEnv();
  const username = env.TRANSMISSION_USERNAME || env.USERNAME;
  const password = env.TRANSMISSION_PASSWORD || env.PASSWORD;
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(username && password
      ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
      : {})
  };
}

function transmissionRpcUrl() {
  const base = serviceBaseUrl('transmission').replace(/\/+$/, '');
  if (base.endsWith('/transmission/rpc')) return base;
  if (base.endsWith('/transmission/web')) return `${base.slice(0, -'/web'.length)}/rpc`;
  if (base.endsWith('/transmission')) return `${base}/rpc`;
  return `${base}/transmission/rpc`;
}

async function qbittorrentGet<T>(path: string): Promise<T> {
  const auth = await qbittorrentAuth();
  const response = await fetch(`${qbittorrentBaseUrl()}/api/v2/${path.replace(/^\//, '')}`, {
    headers: { accept: 'application/json', ...auth.headers }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`qBittorrent ${path} failed: HTTP ${response.status}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function qbittorrentPost(path: string, params: Record<string, string | number | boolean>) {
  const auth = await qbittorrentAuth();
  const response = await fetch(`${qbittorrentBaseUrl()}/api/v2/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: `${qbittorrentBaseUrl()}/`,
      origin: qbittorrentBaseUrl(),
      ...auth.headers
    },
    body: new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`qBittorrent ${path} failed: HTTP ${response.status} ${text}`.trim());
  return text;
}

async function qbittorrentAuth(): Promise<{ headers: Record<string, string> }> {
  const env = readEnv();
  const username = env.QBITTORRENT_USERNAME || env.USERNAME;
  const password = env.QBITTORRENT_PASSWORD || env.PASSWORD;
  if (!username || !password) return { headers: {} };

  const response = await fetch(`${qbittorrentBaseUrl()}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: `${qbittorrentBaseUrl()}/`,
      origin: qbittorrentBaseUrl()
    },
    body: new URLSearchParams({ username, password })
  });
  const text = await response.text();
  if (!response.ok || text !== 'Ok.') throw new Error(`qBittorrent login failed: ${text || `HTTP ${response.status}`}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  return { headers: cookie ? { cookie } : {} };
}

function qbittorrentBaseUrl() {
  return serviceBaseUrl('qbittorrent').replace(/\/+$/, '');
}

function transmissionId(id: string) {
  return /^\d+$/.test(id) ? Number(id) : id;
}

function clampPriority(priority: number) {
  if (priority > 0) return 1;
  if (priority < 0) return -1;
  return 0;
}

function isStalled(item: DownloadItem) {
  if (/stalled/i.test(item.status)) return true;
  return /downloading/i.test(item.status) && (item.rateDownload ?? 0) <= 0;
}

function timestamp(value?: number) {
  if (!value || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}

function transmissionStatus(status: number) {
  switch (status) {
    case 0:
      return 'stopped';
    case 1:
      return 'check-wait';
    case 2:
      return 'checking';
    case 3:
      return 'download-wait';
    case 4:
      return 'downloading';
    case 5:
      return 'seed-wait';
    case 6:
      return 'seeding';
    default:
      return `unknown-${status}`;
  }
}
