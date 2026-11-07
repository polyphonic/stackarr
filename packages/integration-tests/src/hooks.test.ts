import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
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

test('Transmission preset retains shared incomplete staging and the unsafe hook', async () => {
  const script = await readFile(path.join(repoRoot, 'stackarr/scripts/downloads.sh'), 'utf8');
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  assert.match(script, /local desired_incomplete="\/downloads\/\$DOWNLOAD_INCOMPLETE_NAME"/);
  assert.match(script, /local desired_complete="\/downloads\/\$DOWNLOAD_COMPLETE_NAME"/);
  assert.match(script, /"incomplete-dir": sys\.argv\[3\]/);
  assert.match(script, /"download-dir": sys\.argv\[2\]/);
  assert.match(script, /"script-torrent-added-filename": "\/config\/hooks\/transmission-delete-unsafe\.sh"/);
  assert.match(script, /"script-torrent-done-filename": "\/config\/hooks\/transmission-delete-unsafe\.sh"/);
  assert.match(script, /cp "\$TRANSMISSION_UNSAFE_PAYLOAD_HOOK_SOURCE" "\$unsafe_payload_hook_dest"/);
  assert.match(compose, /TRANSMISSION_INCOMPLETE_DIR: \/downloads\/\$\{DOWNLOAD_INCOMPLETE_NAME:-incomplete\}/);
  assert.match(script, /"movieCategory" "\$RADARR_CATEGORY"/);
  assert.match(script, /"tvCategory" "\$SONARR_CATEGORY"/);
});

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

test('Transmission added callback never routes unfinished torrents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-transmission-incomplete-'));

  try {
    const fixture = await transmissionHookFixture(root, {
      id: 42,
      percentDone: 0.5,
      labels: ['tv-sonarr'],
      downloadDir: '/downloads/complete/tv-sonarr'
    });

    await execFile('sh', [transmissionHook], { env: { ...fixture.env, TR_TORRENT_EVENT: 'added' } });
    assert.equal(await readFile(fixture.log, 'utf8'), '');
    await assert.rejects(access(path.join(root, 'downloads/incomplete/tv-sonarr')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Transmission done callback never moves completed torrents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-transmission-complete-'));

  try {
    const fixture = await transmissionHookFixture(root, {
      id: 42,
      percentDone: 1,
      labels: ['radarr'],
      downloadDir: '/downloads/incomplete/radarr'
    });

    await execFile('sh', [transmissionHook], { env: { ...fixture.env, TR_TORRENT_EVENT: 'done' } });
    assert.equal(await readFile(fixture.log, 'utf8'), '');
    await assert.rejects(access(path.join(root, 'downloads/complete/radarr')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Transmission callback does not infer a physical move from a different logical downloadDir', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-transmission-label-'));

  try {
    const fixture = await transmissionHookFixture(root, {
      id: 42,
      percentDone: 0.25,
      labels: ['radarr'],
      downloadDir: '/downloads/complete/radarr'
    });

    const staged = path.join(root, 'staged-physical', 'Safe release');
    await mkdir(path.dirname(staged), { recursive: true });
    await writeFile(staged, 'staged bytes');
    await execFile('sh', [transmissionHook], { env: { ...fixture.env, TR_TORRENT_EVENT: 'added' } });
    assert.equal(await readFile(fixture.log, 'utf8'), '');
    assert.equal(await readFile(staged, 'utf8'), 'staged bytes');
    await assert.rejects(access(path.join(root, 'downloads/incomplete/radarr')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Transmission unsafe name removal is bounded and never deletes local data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-transmission-unsafe-name-'));
  try {
    const fixture = await transmissionHookFixture(root, {
      id: 42,
      percentDone: 0,
      labels: [],
      downloadDir: '/downloads'
    });
    await assert.rejects(
      execFile('sh', [transmissionHook], {
        env: { ...fixture.env, TR_TORRENT_NAME: 'Bad\\Release', TR_TORRENT_EVENT: 'added' }
      }),
      (error: unknown) => (error as { code?: number }).code === 1
    );
    assert.equal(
      await readFile(fixture.log, 'utf8'),
      'curl --max-time 5\ncurl --max-time 5 torrent-remove delete-local-data:false\n'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Transmission unsafe payload is filtered without moving safe staged bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-transmission-unsafe-payload-'));
  try {
    const fixture = await transmissionHookFixture(root, {
      id: 42,
      percentDone: 1,
      labels: [],
      downloadDir: '/downloads'
    });
    const release = path.join(root, 'Safe release');
    await mkdir(release);
    await writeFile(path.join(release, 'movie.mkv'), 'safe bytes');
    await writeFile(path.join(release, 'malware.exe'), 'unsafe bytes');
    await assert.rejects(
      execFile('sh', [transmissionHook], {
        env: { ...fixture.env, TR_TORRENT_EVENT: 'done' }
      })
    );
    assert.equal(await readFile(path.join(release, 'movie.mkv'), 'utf8'), 'safe bytes');
    await assert.rejects(access(path.join(release, 'malware.exe')));
    assert.equal(
      await readFile(fixture.log, 'utf8'),
      'curl --max-time 5\ncurl --max-time 5 torrent-remove delete-local-data:false\n'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function transmissionHookFixture(
  root: string,
  torrent: { id: number; percentDone: number; labels: string[]; downloadDir: string }
) {
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'transmission-remote.log');
  await mkdir(bin, { recursive: true });
  await writeFile(log, '');
  await writeFile(
    path.join(bin, 'curl'),
    `#!/bin/sh
printf 'curl' >> "$STACKARR_TEST_TRANSMISSION_LOG"
for arg do
  case "$arg" in
    --max-time|5) printf ' %s' "$arg" >> "$STACKARR_TEST_TRANSMISSION_LOG" ;;
    *'"method":"torrent-remove"'*) printf ' torrent-remove delete-local-data:false' >> "$STACKARR_TEST_TRANSMISSION_LOG" ;;
  esac
done
printf '\\n' >> "$STACKARR_TEST_TRANSMISSION_LOG"
case " $* " in
  *" -D - "*) printf 'HTTP/1.1 409 Conflict\\nX-Transmission-Session-Id: test-session\\n' ;;
  *) printf '%s' "$STACKARR_TEST_TORRENT_JSON" ;;
esac
`,
    { mode: 0o755 }
  );
  await writeFile(
    path.join(bin, 'transmission-remote'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$STACKARR_TEST_TRANSMISSION_LOG"
`,
    { mode: 0o755 }
  );

  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      USER: 'stackarr',
      PASS: 'secret',
      TR_TORRENT_DIR: root,
      TR_TORRENT_NAME: 'Safe release',
      TR_TORRENT_ID: String(torrent.id),
      STACKARR_DOWNLOADS_ROOT: path.join(root, 'downloads'),
      STACKARR_TEST_TORRENT_JSON: JSON.stringify({
        arguments: { torrents: [torrent] },
        result: 'success'
      }),
      STACKARR_TEST_TRANSMISSION_LOG: log
    }
  };
}

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
  const movieTorrent = torrentFixture(['The Invite.mkv']);
  const downloadId = torrentInfohash(movieTorrent);

  try {
    await mkdir(transmissionState, { recursive: true });
    await writeFile(path.join(transmissionState, `${downloadId}.torrent`), movieTorrent);

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
    assert.deepEqual(await readFile(`${destination}.torrent`), movieTorrent);
    const manifest = JSON.parse(await readFile(`${destination}.provenance.json`, 'utf8'));
    assert.match(manifest.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    delete manifest.recordedAt;
    assert.deepEqual(manifest, {
      schemaVersion: 1,
      archiveScope: 'torrent-source',
      provenanceCoverage: 'first-successful-import',
      service: 'radarr',
      instance: 'radarr',
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

test('Sonarr torrent archive hook preserves episode provenance without source URLs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-sonarr-torrent-archive-'));
  const qbittorrentState = path.join(root, 'qbittorrent');
  const torrentArchive = path.join(root, 'torrent-archive');
  const episodeTorrent = torrentFixture(['The Test Series S02E03.mkv']);
  const downloadId = torrentInfohash(episodeTorrent);

  try {
    await mkdir(qbittorrentState, { recursive: true });
    await writeFile(path.join(qbittorrentState, `${downloadId.toLowerCase()}.torrent`), episodeTorrent);
    const naming = path.join(root, 'naming.json');
    await writeFile(
      naming,
      JSON.stringify({ seasonFolderFormat: 'Season {season:00}', specialsFolderFormat: 'Specials' })
    );

    await execFile('sh', [archiveTorrentHook], {
      env: {
        ...process.env,
        sonarr_eventtype: 'Download',
        sonarr_series_id: '134',
        sonarr_series_title: 'The Test Series',
        sonarr_series_year: '2026',
        sonarr_series_tvdbid: '250307',
        sonarr_series_imdbid: 'tt1234567',
        sonarr_episodefile_id: '902',
        sonarr_episodefile_path: '/tv/The Test Series/Season 02/The Test Series - S02E03.mkv',
        sonarr_episodefile_sourcepath: '/downloads/complete/sonarr/The Test Series S02E03.mkv',
        sonarr_episodefile_scenename: 'The Test Series S02E03 1080p WEB-DL x265-GROUP',
        sonarr_release_title: 'The Test Series S02E03 1080p WEB-DL x265-GROUP',
        sonarr_release_indexer: 'Example Indexer',
        sonarr_release_quality: 'WEBDL-1080p',
        sonarr_release_size: '1073741824',
        sonarr_download_client: 'qBittorrent',
        sonarr_download_id: downloadId,
        sonarr_download_url: 'https://example.invalid/private.torrent',
        TRANSMISSION_TORRENT_STATE_DIR: path.join(root, 'transmission'),
        QBITTORRENT_TORRENT_STATE_DIR: qbittorrentState,
        TORRENT_ARCHIVE_ROOT: torrentArchive,
        TORRENT_SONARR_NAMING_CONFIG: naming
      }
    });

    const destination = path.join(
      torrentArchive,
      'TV Shows/The Test Series/Season 02/The Test Series S02E03 1080p WEB-DL x265-GROUP'
    );
    assert.deepEqual(await readFile(`${destination}.torrent`), episodeTorrent);
    const manifestText = await readFile(`${destination}.provenance.json`, 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.match(manifest.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    delete manifest.recordedAt;
    assert.deepEqual(manifest, {
      schemaVersion: 1,
      archiveScope: 'torrent-source',
      provenanceCoverage: 'first-successful-import',
      service: 'sonarr',
      instance: 'sonarr',
      mediaType: 'episode',
      eventType: 'Download',
      title: 'The Test Series',
      year: '2026',
      arrItemId: '134',
      arrFileId: '902',
      imdbId: 'tt1234567',
      tvdbId: '250307',
      releaseTitle: 'The Test Series S02E03 1080p WEB-DL x265-GROUP',
      indexer: 'Example Indexer',
      downloadClient: 'qBittorrent',
      downloadId,
      quality: 'WEBDL-1080p',
      releaseSize: '1073741824',
      sourcePath: '/downloads/complete/sonarr/The Test Series S02E03.mkv',
      importedPath: '/tv/The Test Series/Season 02/The Test Series - S02E03.mkv',
      torrentFile: 'The Test Series S02E03 1080p WEB-DL x265-GROUP.torrent'
    });
    assert.doesNotMatch(manifestText, /example\.invalid|download_url/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function bencode(value: unknown): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') return bencode(Buffer.from(value));
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  const record = value as Record<string, unknown>;
  return Buffer.concat([
    Buffer.from('d'),
    ...Object.entries(record)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([key, part]) => [bencode(key), bencode(part)]),
    Buffer.from('e')
  ]);
}

function torrentFixture(paths: string[], version: 'v1' | 'v2' | 'hybrid' = 'v1'): Buffer {
  const files = paths.map((name) => ({ length: 1, path: name.split('/') }));
  const tree: Record<string, unknown> = {};
  for (const name of paths) {
    let cursor = tree;
    for (const part of name.split('/')) {
      cursor[part] ??= {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[''] = { length: 1 };
  }
  const info: Record<string, unknown> = { name: 'Test torrent', 'piece length': 16384 };
  if (version !== 'v2') info.pieces = Buffer.alloc(20, 88);
  if (version !== 'v2') info.files = files;
  if (version !== 'v1') {
    info['meta version'] = 2;
    info['file tree'] = tree;
  }
  return bencode({ announce: 'https://private.invalid/passkey-secret', info });
}

function torrentInfohash(torrent: Buffer): string {
  const start = torrent.indexOf(Buffer.from('4:info')) + 6;
  return createHash('sha1')
    .update(torrent.subarray(start, torrent.length - 1))
    .digest('hex')
    .toUpperCase();
}

test('torrent classifier covers v1, v2, hybrid, specials and ambiguity without disclosing trackers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-metainfo-'));
  const helper = path.join(repoRoot, 'stackarr/scripts/hooks/torrent-seasons.py');
  try {
    for (const version of ['v1', 'v2', 'hybrid'] as const) {
      for (const [files, expected] of [
        [['Show S02E01.mkv'], 'single 2'],
        [['Season 02/one.mkv', 'Season 02/two.mp4'], 'single 2'],
        [['Season 01/one.mkv', 'Season 02/two.mkv'], 'multi'],
        [['Show S00E01.mkv'], 'single 0'],
        [['Show.mkv'], 'unknown'],
        [['Show S01E01.mkv', 'Show.mkv'], 'unknown'],
        [['Season 01/Show S02E01.mkv'], 'unknown'],
        [['S01/untitled.mkv'], 'single 1'],
        [['Show S01/untitled.mkv'], 'single 1'],
        [['Show Season 1/untitled.mkv'], 'single 1'],
        [['Show 1x02.mkv'], 'single 1'],
        [['Show S01E01.mkv', 'unknown.mkv'], 'unknown'],
        [['S01/Show 2x02.mkv'], 'unknown']
      ] as const) {
        const file = path.join(root, 'test.torrent');
        await writeFile(file, torrentFixture([...files], version));
        const { stdout } = await execFile('python3', [helper, file]);
        assert.equal(stdout.trim(), expected);
        assert.doesNotMatch(stdout, /private|passkey|https/);
      }
    }
    const hybridPad = bencode({
      info: {
        name: 'Show',
        'meta version': 2,
        files: [
          { length: 1, path: ['S01', 'episode.mkv'] },
          { length: 1, path: ['.pad', '0'], attr: 'p' }
        ],
        'file tree': { S01: { 'episode.mkv': { '': { length: 1 } } } }
      }
    });
    await writeFile(path.join(root, 'test.torrent'), hybridPad);
    assert.equal((await execFile('python3', [helper, path.join(root, 'test.torrent')])).stdout.trim(), 'single 1');
    const malformed = [
      bencode({ info: { name: 'Show', files: [{ length: 1, path: 42 }] } }),
      bencode({ info: { name: 'Show', files: [{ length: 1, path: ['S01', 42] }] } })
    ];
    for (const payload of malformed) {
      const file = path.join(root, 'test.torrent');
      await writeFile(file, payload);
      const { stdout } = await execFile('python3', [helper, file]);
      assert.equal(stdout.trim(), 'unknown');
    }
    await writeFile(path.join(root, 'test.torrent'), 'not bencode');
    const { stdout } = await execFile('python3', [helper, path.join(root, 'test.torrent')]);
    assert.equal(stdout.trim(), 'unknown');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Sonarr archives whole multi-season once at show root and canonicalizes single seasons', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-season-archive-'));
  const hash = torrentInfohash(torrentFixture(['Show S01E01.mkv', 'Show S02E01.mkv']));
  const state = path.join(root, 'state');
  const archive = path.join(root, 'archive');
  const naming = path.join(root, 'naming.json');
  try {
    await mkdir(state);
    await writeFile(
      naming,
      JSON.stringify({ seasonFolderFormat: 'Season {season:00}', specialsFolderFormat: 'Specials' })
    );
    const env = {
      ...process.env,
      sonarr_eventtype: 'Download',
      sonarr_download_id: hash,
      sonarr_download_client: 'Transmission',
      sonarr_release_title: 'Original.Release',
      TRANSMISSION_TORRENT_STATE_DIR: state,
      QBITTORRENT_TORRENT_STATE_DIR: path.join(root, 'missing'),
      TORRENT_ARCHIVE_ROOT: archive,
      TORRENT_SONARR_NAMING_CONFIG: naming
    };
    let activeHash = hash;
    const invoke = async (torrent: Buffer, imported: string, release = 'Original.Release') => {
      activeHash = torrentInfohash(torrent);
      await writeFile(path.join(state, `${activeHash}.torrent`), torrent);
      await execFile('sh', [archiveTorrentHook], {
        env: {
          ...env,
          sonarr_download_id: activeHash,
          sonarr_release_title: release,
          sonarr_episodefile_path: imported
        }
      });
    };
    const multi = torrentFixture(['Show S01E01.mkv', 'Show S02E01.mkv']);
    await invoke(multi, '/tv/Show/Season 1/Show S01E01.mkv');
    assert.deepEqual(await readFile(path.join(archive, 'TV Shows/Show/Original.Release.torrent')), multi);
    await assert.rejects(access(path.join(archive, 'TV Shows/Show/Season 1/Original.Release.torrent')));
    await invoke(multi, '/tv/Show/Season 02/Show S02E01.mkv');
    const single = torrentFixture(['Show S02E01.mkv', 'Show S02E02.mkv']);
    activeHash = '1123456789ABCDEF0123456789ABCDEF01234567';
    await invoke(single, '/tv/Other/Season 2/Other S02E01.mkv', 'Season.Pack');
    await access(path.join(archive, 'TV Shows/Other/Season 02/Season.Pack.torrent'));
    activeHash = '2123456789ABCDEF0123456789ABCDEF01234567';
    await invoke(torrentFixture(['Show S00E01.mkv']), '/tv/Show/Season 0/Show S00E01.mkv', 'Special');
    await access(path.join(archive, 'TV Shows/Show/Specials/Special.torrent'));
    activeHash = '3123456789ABCDEF0123456789ABCDEF01234567';
    await invoke(torrentFixture(['Show S02E01.mkv']), '/tv/Show/Show S02E01.mkv', 'No.Season');
    await access(path.join(archive, 'TV Shows/Show/No.Season.torrent'));
    activeHash = '4123456789ABCDEF0123456789ABCDEF01234567';
    await invoke(torrentFixture(['Show.mkv']), '/tv/Show/Season 2/Show S02E01.mkv', 'Ambiguous');
    await assert.rejects(access(path.join(archive, 'TV Shows/Show/Season 02/Ambiguous.torrent')));
    await access(path.join(archive, `_Unresolved/sonarr/${activeHash}.torrent`));
    activeHash = '5123456789ABCDEF0123456789ABCDEF01234567';
    await invoke(single, '/tv/Other/Season 2/Other S02E01.mkv', 'Season.Pack');
    assert.deepEqual(await readFile(path.join(archive, 'TV Shows/Other/Season 02/Season.Pack.torrent')), single);
    activeHash = '6123456789ABCDEF0123456789ABCDEF01234567';
    const differentPack = torrentFixture(['Show S02E03.mkv']);
    await invoke(differentPack, '/tv/Other/Season 2/Other S02E03.mkv', 'Season.Pack');
    assert.deepEqual(
      await readFile(path.join(archive, `TV Shows/Other/Season 02/Season.Pack [${activeHash}].torrent`)),
      differentPack
    );
    assert.deepEqual(await readFile(path.join(archive, 'TV Shows/Other/Season 02/Season.Pack.torrent')), single);
    const missingConfigTorrent = torrentFixture(['Show S03E01.mkv']);
    activeHash = torrentInfohash(missingConfigTorrent);
    await writeFile(path.join(state, `${activeHash}.torrent`), missingConfigTorrent);
    await execFile('sh', [archiveTorrentHook], {
      env: {
        ...env,
        sonarr_download_id: activeHash,
        sonarr_release_title: 'Missing.Config',
        sonarr_episodefile_path: '/tv/Show/Season 3/Show S03E01.mkv',
        TORRENT_SONARR_NAMING_CONFIG: path.join(root, 'missing.json')
      }
    });
    await assert.rejects(access(path.join(archive, 'TV Shows/Show/Season 03/Missing.Config.torrent')));
    await access(path.join(archive, `_Unresolved/sonarr/${activeHash}.torrent`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
