import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const stateDir = mkdtempSync(path.join(tmpdir(), 'stackarr-arr-provenance-test-'));
process.env.STACKARR_DATABASE_FILE = path.join(stateDir, 'stackarr.db');

function core() {
  return import('../../core/src/index.ts');
}

async function writeRuntimeConfig(config: Record<string, string>) {
  const { writeEnvConfig } = await core();
  writeEnvConfig(config);
}

test('Arr provenance joins grab and import history without returning source URLs', async () => {
  const requests: string[] = [];
  const server = await startServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(url.pathname);
    assert.equal(url.searchParams.get('apikey'), 'fixture-arr-key');

    if (url.pathname === '/api/v3/history/movie') {
      assert.equal(url.searchParams.get('movieId'), '603');
      json(response, [
        {
          id: 1056,
          eventType: 'downloadFolderImported',
          sourceTitle: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE',
          date: '2026-08-10T09:50:57Z',
          downloadId: 'invite-hash',
          quality: { quality: { name: 'WEBDL-1080p' } },
          customFormats: [{ name: 'x265' }],
          data: {
            downloadClientName: 'Transmission',
            importedPath: '/movies/The Invite (2026)/The Invite.mkv',
            droppedPath: '/downloads/The Invite.mkv',
            size: 1919161899
          }
        },
        {
          id: 1055,
          eventType: 'grabbed',
          sourceTitle: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE',
          date: '2026-08-10T09:37:13Z',
          downloadId: 'invite-hash',
          quality: { quality: { name: 'WEBDL-1080p' } },
          customFormats: [{ name: 'x265' }, { name: 'DCP Rip' }],
          data: {
            indexer: 'Example Indexer',
            downloadClientName: 'Transmission',
            protocol: 'torrent',
            releaseSource: 'Prowlarr',
            torrentInfoHash: 'invite-hash',
            downloadUrl: 'magnet:?xt=urn:btih:must-not-leak',
            guid: 'must-not-leak'
          }
        }
      ]);
      return;
    }

    assert.equal(url.pathname, '/api/v3/history');
    assert.equal(url.searchParams.get('episodeId'), '19084');
    json(response, {
      records: [
        {
          id: 7066,
          eventType: 'downloadFolderImported',
          sourceTitle: 'Show.S03E08.1080p.WEBRip.x265',
          date: '2026-08-10T04:24:28Z',
          downloadId: 'episode-hash',
          quality: { quality: { name: 'WEBRip-1080p' } },
          data: {
            downloadClientName: 'Transmission',
            importedPath: '/tv/Show/Season 03/Show S03E08.mkv',
            droppedPath: '/downloads/Show.S03E08.mkv'
          }
        },
        {
          id: 7065,
          eventType: 'grabbed',
          sourceTitle: 'Show.S03E08.1080p.WEBRip.x265',
          date: '2026-08-10T02:59:11Z',
          downloadId: 'episode-hash',
          quality: { quality: { name: 'WEBRip-1080p' } },
          data: {
            indexer: 'Example Indexer',
            downloadClientName: 'Transmission',
            protocol: 'torrent',
            torrentInfoHash: 'episode-hash',
            downloadUrl: 'magnet:?xt=urn:btih:must-not-leak'
          }
        }
      ]
    });
  });

  try {
    const { getEpisodeDownloadProvenanceAction, getMovieDownloadProvenanceAction } = await core();
    await writeRuntimeConfig({
      CONFIG_ROOT: path.join(stateDir, 'config'),
      RADARR_URL: server.url,
      RADARR_API_KEY: 'fixture-arr-key',
      SONARR_URL: server.url,
      SONARR_API_KEY: 'fixture-arr-key'
    });

    const movie = await getMovieDownloadProvenanceAction({ instance: 'radarr', movieId: 603 });
    const episode = await getEpisodeDownloadProvenanceAction({ instance: 'sonarr', episodeId: 19084 });

    assert.deepEqual(movie.downloads, [
      {
        downloadId: 'invite-hash',
        sourceTitle: 'The Invite 2026 1080p WEB-DL HEVC x265 5.1 BONE',
        quality: 'WEBDL-1080p',
        customFormats: ['x265', 'DCP Rip'],
        indexer: 'Example Indexer',
        downloadClient: 'Transmission',
        protocol: 'torrent',
        releaseSource: 'Prowlarr',
        torrentInfoHash: 'invite-hash',
        size: 1919161899,
        grabbedAt: '2026-08-10T09:37:13Z',
        importedAt: '2026-08-10T09:50:57Z',
        importedPath: '/movies/The Invite (2026)/The Invite.mkv',
        sourcePath: '/downloads/The Invite.mkv',
        historyRecordIds: [1056, 1055]
      }
    ]);
    assert.equal(episode.downloads[0].downloadId, 'episode-hash');
    assert.equal(episode.downloads[0].indexer, 'Example Indexer');
    assert.equal(episode.downloads[0].importedPath, '/tv/Show/Season 03/Show S03E08.mkv');
    assert.doesNotMatch(JSON.stringify({ movie, episode }), /downloadUrl|magnet:|guid|must-not-leak/);
    assert.deepEqual(requests, ['/api/v3/history/movie', '/api/v3/history']);
  } finally {
    await server.close();
  }
});

function startServer(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}

function json(response: ServerResponse, data: unknown) {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(data));
}
