import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const transmissionHook = path.join(repoRoot, 'stackarr/scripts/hooks/transmission-delete-unsafe.sh');
const archiveTorrentHook = path.join(repoRoot, 'stackarr/scripts/hooks/archive-torrent.sh');
const postImportMediaHook = path.join(repoRoot, 'stackarr/scripts/hooks/post-import-media.sh');

test('Transmission unsafe hook rejects torrent names with Windows separators', async () => {
  await execFile('sh', [transmissionHook], {
    env: {
      ...process.env,
      TR_TORRENT_DIR: tmpdir(),
      TR_TORRENT_NAME: 'Safe Album',
      TR_TORRENT_ID: '1'
    }
  });

  await assert.rejects(
    execFile('sh', [transmissionHook], {
      env: {
        ...process.env,
        TR_TORRENT_DIR: tmpdir(),
        TR_TORRENT_NAME: 'Bad\\Album',
        TR_TORRENT_ID: '2'
      }
    }),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, 1);
      assert.match((error as { stderr?: string }).stderr ?? '', /removed unsafe torrent name: Bad\\Album/);
      return true;
    }
  );
});

test('Radarr post-import hook copies Plex extras and updates then scrapes through the TMM API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-radarr-post-import-'));
  const source = path.join(root, 'downloads', 'Movie.Release');
  const destination = path.join(root, 'movies', 'Movie (2026)');
  const requests: Array<{ method?: string; url?: string; apiKey?: string; body: unknown }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        apiKey: request.headers['api-key'] as string | undefined,
        body: JSON.parse(body)
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
  });

  try {
    await mkdir(path.join(source, 'Featurettes'), { recursive: true });
    await mkdir(path.join(source, 'Behind the Scenes'), { recursive: true });
    await mkdir(path.join(source, 'Samples'), { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(source, 'Movie.Release.mkv'), 'main movie');
    await writeFile(path.join(source, 'Featurettes', 'Making Of.mkv'), 'featurette');
    await writeFile(path.join(source, 'Behind the Scenes', 'Set Tour.mp4'), 'behind the scenes');
    await writeFile(path.join(source, 'Samples', 'sample.mkv'), 'sample');

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await execFile('sh', [postImportMediaHook], {
      env: {
        ...process.env,
        radarr_eventtype: 'Download',
        radarr_movie_path: destination,
        radarr_moviefile_sourcefolder: source,
        radarr_moviefile_sourcepath: path.join(source, 'Movie.Release.mkv'),
        TMM_API_URL: `http://127.0.0.1:${address.port}`,
        TMM_API_KEY: 'test-tmm-key'
      }
    });

    assert.equal(await readFile(path.join(destination, 'Featurettes', 'Making Of.mkv'), 'utf8'), 'featurette');
    assert.equal(
      await readFile(path.join(destination, 'Behind The Scenes', 'Set Tour.mp4'), 'utf8'),
      'behind the scenes'
    );
    await assert.rejects(access(path.join(destination, 'Samples', 'sample.mkv')));
    await assert.rejects(access(path.join(destination, 'Movie.Release.mkv')));
    assert.deepEqual(requests, [
      {
        method: 'POST',
        url: '/api/movie',
        apiKey: 'test-tmm-key',
        body: [
          { action: 'update', scope: { name: 'all' } },
          { action: 'scrape', scope: { name: 'new' } }
        ]
      }
    ]);
  } finally {
    if (server.listening) server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Sonarr post-import hook uses show-level Plex extras and the TMM TV API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-sonarr-post-import-'));
  const source = path.join(root, 'downloads', 'Show.Release');
  const destination = path.join(root, 'tv', 'Show (2026)');
  const requests: Array<{ url?: string; body: unknown }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url, body: JSON.parse(body) });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
  });

  try {
    await mkdir(path.join(source, 'Extras'), { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(source, 'Extras', 'Cast Game.webm'), 'extra');

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await execFile('sh', [postImportMediaHook], {
      env: {
        ...process.env,
        sonarr_eventtype: 'Download',
        sonarr_sourcepath: source,
        sonarr_series_path: destination,
        TMM_API_URL: `http://127.0.0.1:${address.port}`,
        TMM_API_KEY: 'test-tmm-key'
      }
    });

    assert.equal(await readFile(path.join(destination, 'Other', 'Cast Game.webm'), 'utf8'), 'extra');
    assert.deepEqual(requests, [
      {
        url: '/api/tvshow',
        body: [
          { action: 'update', scope: { name: 'all' } },
          { action: 'scrape', scope: { name: 'new' } }
        ]
      }
    ]);
  } finally {
    if (server.listening) server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Radarr torrent archive hook preserves the torrent and a safe provenance manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-radarr-torrent-archive-'));
  const transmissionState = path.join(root, 'transmission');
  const torrentArchive = path.join(root, 'torrent-archive');
  const downloadId = '8FA681025431DF62CE2E31ACDEE83FCDA921E05A';

  try {
    await mkdir(transmissionState, { recursive: true });
    await writeFile(path.join(transmissionState, `${downloadId}.torrent`), 'torrent fixture');

    await execFile('sh', [archiveTorrentHook], {
      env: {
        ...process.env,
        radarr_eventtype: 'Download',
        radarr_movie_id: '603',
        radarr_movie_title: 'The Invite',
        radarr_movie_year: '2026',
        radarr_movie_tmdbid: '950028',
        radarr_movie_imdbid: 'tt14173636',
        radarr_moviefile_id: '901',
        radarr_moviefile_path: '/movies/The Invite (2026)/The Invite (2026).mkv',
        radarr_moviefile_sourcepath: '/downloads/complete/radarr/The Invite.mkv',
        radarr_moviefile_scenename: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE',
        radarr_release_title: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE',
        radarr_release_indexer: 'Example Indexer',
        radarr_release_quality: 'WEBDL-1080p',
        radarr_download_client: 'Transmission',
        radarr_download_id: downloadId,
        TRANSMISSION_TORRENT_STATE_DIR: transmissionState,
        QBITTORRENT_TORRENT_STATE_DIR: path.join(root, 'qbittorrent'),
        TORRENT_ARCHIVE_ROOT: torrentArchive
      }
    });

    const destination = path.join(
      torrentArchive,
      'Movies/The Invite (2026)/The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE'
    );
    assert.equal(await readFile(`${destination}.torrent`, 'utf8'), 'torrent fixture');
    const manifest = JSON.parse(await readFile(`${destination}.provenance.json`, 'utf8'));
    assert.match(manifest.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    delete manifest.recordedAt;
    assert.deepEqual(manifest, {
      schemaVersion: 1,
      service: 'radarr',
      mediaType: 'movie',
      eventType: 'Download',
      title: 'The Invite',
      year: '2026',
      arrItemId: '603',
      arrFileId: '901',
      tmdbId: '950028',
      imdbId: 'tt14173636',
      releaseTitle: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE',
      indexer: 'Example Indexer',
      downloadClient: 'Transmission',
      downloadId,
      quality: 'WEBDL-1080p',
      sourcePath: '/downloads/complete/radarr/The Invite.mkv',
      importedPath: '/movies/The Invite (2026)/The Invite (2026).mkv',
      torrentFile: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE.torrent'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
