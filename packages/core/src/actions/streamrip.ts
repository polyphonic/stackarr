import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonSetting, writeJsonSetting } from '../database';
import { readEnv } from '../env';
import {
  getStreamripStateRoot,
  isManagedStreamripDatabasePath,
  normalizeStreamripDatabasePath,
  readStreamripConfig,
  renderStreamripToml,
  updateStreamripConfig
} from '../streamrip/config';

const jobsKey = 'stackarr.streamripJobs';
const allowedStreamripUrlDomains = ['qobuz.com', 'tidal.com', 'deezer.com', 'soundcloud.com'];
type SQLiteModule = typeof import('node:sqlite');
type SQLiteDatabase = InstanceType<SQLiteModule['DatabaseSync']>;

type StreamripJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StreamripSource = 'qobuz' | 'tidal' | 'deezer' | 'soundcloud';
export type StreamripMediaType = 'album' | 'track' | 'playlist' | 'artist';
export type StreamripJob = {
  id: string;
  type: 'url' | 'search';
  url?: string;
  source?: StreamripSource;
  mediaType?: StreamripMediaType;
  query?: string;
  lidarrAlbumId?: number;
  lidarrAlbumTitle?: string;
  lidarrArtistName?: string;
  status: StreamripJobStatus;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  error?: string;
  outputTail?: string;
};

const activeProcesses = new Map<string, ReturnType<typeof spawn>>();
type StreamripCliStatus = { command: string; available: boolean; version?: string; error?: string };
type DeezerArlStatus = { arlPresent: boolean; arlLength: number; authenticated?: boolean; error?: string };

export function getStreamripConfigAction() {
  return { config: readStreamripConfig() };
}

export function updateStreamripConfigAction(input: { values: Record<string, unknown> }) {
  return { accepted: true, config: updateStreamripConfig(input.values ?? {}) };
}

export async function testStreamripAction() {
  const cli = await testStreamripCli();
  return { ...cli, deezer: await testDeezerArl() };
}

function testStreamripCli() {
  const command = streamripCommand();
  return new Promise<StreamripCliStatus>((resolve) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => resolve({ command, available: false, error: error.message }));
    child.on('close', (code) =>
      resolve({
        command,
        available: code === 0,
        version: stdout.trim() || undefined,
        error: code === 0 ? undefined : stderr.trim() || `Exited with ${code}`
      })
    );
  });
}

async function testDeezerArl(): Promise<DeezerArlStatus> {
  const arl = String(readStreamripConfig({ redactSecrets: false }).deezer?.arl ?? '').trim();
  const result: DeezerArlStatus = { arlPresent: Boolean(arl), arlLength: arl.length };
  if (!arl) return result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const url = new URL('https://www.deezer.com/ajax/gw-light.php');
    url.search = new URLSearchParams({
      method: 'deezer.getUserData',
      input: '3',
      api_version: '1.0',
      api_token: ''
    }).toString();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `arl=${arl}`,
        origin: 'https://www.deezer.com',
        referer: 'https://www.deezer.com/',
        'user-agent': 'Mozilla/5.0'
      },
      body: '{}',
      signal: controller.signal
    });
    const data = (await response.json()) as { results?: { USER?: { USER_ID?: number } } };
    result.authenticated = Number(data.results?.USER?.USER_ID ?? 0) > 0;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Could not test Deezer ARL.';
  } finally {
    clearTimeout(timeout);
  }
  return result;
}

export async function startStreamripDownloadAction(input: { url: string }) {
  const url = normalizeStreamripDownloadUrl(input.url);
  const job: StreamripJob = createJob({ type: 'url', url });
  return startStreamripJob(job, ['--config-path', await writeStreamripConfigFile(), 'url', url]);
}

export async function startStreamripSearchDownloadAction(input: {
  source: StreamripSource;
  mediaType?: StreamripMediaType;
  query: string;
  lidarrAlbumId?: number;
  lidarrAlbumTitle?: string;
  lidarrArtistName?: string;
}) {
  const source = normalizeSource(input.source);
  const mediaType = normalizeMediaType(input.mediaType ?? 'album');
  const query = String(input.query ?? '').trim();
  if (!query) throw new Error('Streamrip search download requires a search query.');

  const job: StreamripJob = createJob({
    type: 'search',
    source,
    mediaType,
    query,
    lidarrAlbumId: input.lidarrAlbumId,
    lidarrAlbumTitle: input.lidarrAlbumTitle,
    lidarrArtistName: input.lidarrArtistName
  });
  return startStreamripJob(job, [
    '--config-path',
    await writeStreamripConfigFile(),
    'search',
    '--first',
    source,
    mediaType,
    query
  ]);
}

export function listStreamripJobsAction() {
  return { jobs: readJsonSetting<StreamripJob[]>(jobsKey, []) };
}

export function cancelStreamripJobAction(input: { id: string }) {
  const child = activeProcesses.get(input.id);
  if (child) child.kill('SIGTERM');
  finishJob(input.id, 'cancelled', {});
  return { accepted: true, id: input.id, cancelled: true };
}

function createJob(job: Omit<StreamripJob, 'id' | 'status' | 'startedAt'>): StreamripJob {
  return {
    id: `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    ...job
  };
}

function startStreamripJob(job: StreamripJob, args: string[]) {
  const jobs = [job, ...listStreamripJobsAction().jobs];
  writeJobs(jobs);

  const child = spawn(streamripCommand(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeProcesses.set(job.id, child);
  let tail = '';
  const append = (chunk: unknown) => {
    tail = `${tail}${String(chunk)}`.slice(-4000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (error) => finishJob(job.id, 'failed', { error: error.message, outputTail: tail }));
  child.on('close', (code) => {
    activeProcesses.delete(job.id);
    finishJob(job.id, code === 0 ? 'completed' : 'failed', {
      exitCode: code,
      outputTail: tail,
      error: code === 0 ? undefined : streamripFailureMessage(job, tail, code)
    });
  });

  return { accepted: true, job };
}

function streamripFailureMessage(job: StreamripJob, outputTail: string, code: number | null) {
  if (job.source === 'deezer' && outputTail.includes('AuthenticationError')) {
    return 'Deezer rejected the configured ARL. Refresh the Deezer ARL in Streamrip settings and try again.';
  }
  if (outputTail.includes('unable to open database file')) {
    return 'Streamrip could not open its internal downloads database.';
  }
  return `Streamrip exited with ${code}`;
}

async function writeStreamripConfigFile() {
  await repairStreamripDatabases();
  const configDir = getStreamripStateRoot();
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.toml');
  fs.writeFileSync(configPath, renderStreamripToml(), { mode: 0o600 });
  return configPath;
}

async function repairStreamripDatabases() {
  const config = readStreamripConfig({ redactSecrets: false });
  const database = config.database ?? {};
  await ensureStreamripDatabase(String(database.downloads_path ?? ''), 'downloads');
  await ensureStreamripDatabase(String(database.failed_downloads_path ?? ''), 'failed_downloads');
}

async function ensureStreamripDatabase(databasePath: string, expectedTable: string) {
  if (!databasePath) return;

  const fallbackFileName = expectedTable === 'downloads' ? 'downloads.db' : 'failed_downloads.db';
  const managedPath = normalizeStreamripDatabasePath(databasePath, fallbackFileName, { strict: true });

  if (!isManagedStreamripDatabasePath(managedPath)) {
    throw new Error('Streamrip database paths must stay under the managed Streamrip state root.');
  }

  const stateRoot = getStreamripStateRoot();
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.mkdirSync(path.dirname(managedPath), { recursive: true });
  const stateRootReal = fs.realpathSync(stateRoot);
  const parentReal = fs.realpathSync(path.dirname(managedPath));

  if (!isRealSubpath(stateRootReal, parentReal)) {
    throw new Error('Streamrip database paths must stay under the managed Streamrip state root.');
  }

  if (!fs.existsSync(managedPath)) return;

  const stat = fs.lstatSync(managedPath);
  if (stat.isSymbolicLink()) {
    fs.rmSync(managedPath, { force: true });
    return;
  }

  if (!stat.isFile()) {
    throw new Error('Streamrip database path must be a file.');
  }

  if (stat.size === 0) {
    fs.rmSync(managedPath, { force: true });
    return;
  }

  let db: SQLiteDatabase | undefined;
  let invalid = false;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(managedPath);
    const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(expectedTable) as
      | { name?: string }
      | undefined;
    if (!row?.name) {
      invalid = true;
    }
  } catch {
    invalid = true;
  } finally {
    db?.close();
  }
  if (invalid) {
    fs.rmSync(managedPath, { force: true });
  }
}

function isRealSubpath(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function streamripCommand() {
  const env = readEnv();
  return env.STREAMRIP_COMMAND || process.env.STREAMRIP_COMMAND || 'rip';
}

function normalizeSource(source: string): StreamripSource {
  if (['qobuz', 'tidal', 'deezer', 'soundcloud'].includes(source)) return source as StreamripSource;
  throw new Error(`Unsupported Streamrip source: ${source}`);
}

function normalizeMediaType(mediaType: string): StreamripMediaType {
  if (['album', 'track', 'playlist', 'artist'].includes(mediaType)) return mediaType as StreamripMediaType;
  throw new Error(`Unsupported Streamrip media type: ${mediaType}`);
}

function normalizeStreamripDownloadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Streamrip download requires a valid provider URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Streamrip download URLs must use HTTPS.');
  }

  if (url.username || url.password || url.port) {
    throw new Error('Streamrip download URLs cannot include credentials or custom ports.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = allowedStreamripUrlDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

  if (!allowed) {
    throw new Error('Streamrip download URL must be for Qobuz, Tidal, Deezer, or SoundCloud.');
  }

  return url.toString();
}

function finishJob(id: string, status: StreamripJobStatus, patch: Partial<StreamripJob>) {
  const jobs = listStreamripJobsAction().jobs.map((job) =>
    job.id === id
      ? {
          ...job,
          ...patch,
          status,
          completedAt: status === 'running' ? undefined : new Date().toISOString()
        }
      : job
  );
  writeJobs(jobs);
}

function writeJobs(jobs: StreamripJob[]) {
  writeJsonSetting(jobsKey, jobs.slice(0, 100));
}
