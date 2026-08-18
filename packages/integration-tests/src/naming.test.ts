import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const namingConfigUrl = new URL('../../../stackarr/config/naming.json', import.meta.url);
const requestsConfigUrl = new URL('../../../stackarr/config/requests.json', import.meta.url);

function functionRange(source: string, first: string, next: string): string {
  const start = source.indexOf(`${first}() {`);
  const end = source.indexOf(`\n${next}() {`, start);
  assert.notEqual(start, -1, `missing ${first}`);
  assert.notEqual(end, -1, `missing boundary ${next}`);
  return source.slice(start, end);
}

test('TV season folders have one portable naming-policy source of truth', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));
  const requests = JSON.parse(await readFile(requestsConfigUrl, 'utf8'));

  assert.equal(naming.tv.seasonFolders, true);
  assert.equal(naming.sonarr.seasonFolderFormat, 'Season {season:00}');
  assert.equal(naming.tinymediamanager.tvShows.renamerSeasonFoldername, 'Season ${seasonNr2}');
  assert.equal(requests.seerr.tv.enableSeasonFolders, undefined);
});

test('naming policy reconciles existing Sonarr series through the bulk editor API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-naming-policy-'));
  const harness = path.join(root, 'naming-policy.sh');
  const namingScript = await readFile(new URL('../../../stackarr/scripts/naming.sh', import.meta.url), 'utf8');
  const writes: Array<Record<string, unknown>> = [];
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    assert.equal(request.headers['x-api-key'], 'fixture-key');
    response.setHeader('content-type', 'application/json');

    if (request.method === 'GET' && request.url === '/api/v3/series') {
      response.end(
        JSON.stringify([
          { id: 11, title: 'Needs Policy', seasonFolder: false },
          { id: 12, title: 'Already Correct', seasonFolder: true },
          { id: 13, title: 'Also Needs Policy', seasonFolder: false }
        ])
      );
      return;
    }
    if (request.method === 'PUT' && request.url === '/api/v3/series/editor') {
      writes.push(JSON.parse(rawBody));
      response.writeHead(202);
      response.end('[]');
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const helpers = functionRange(namingScript, 'tv_season_folders_enabled', 'apply_servarr_presets');
    await writeFile(
      harness,
      [
        '#!/bin/bash',
        'set -euo pipefail',
        'ok() { :; }',
        'warn() { :; }',
        `NAMING_CONFIG_FILE=${JSON.stringify(fileURLToPath(namingConfigUrl))}`,
        helpers,
        'reconcile_servarr_series_season_folders "Sonarr" "$BASE_URL" fixture-key',
        ''
      ].join('\n')
    );
    await execFile('bash', [harness], {
      cwd: repoRoot,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}` }
    });

    assert.deepEqual(writes, [{ seriesIds: [11, 13], seasonFolder: true }]);
  } finally {
    if (server.listening) server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Seerr TV services inherit the canonical season-folder naming policy', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-seerr-naming-policy-'));
  const harness = path.join(root, 'seerr-naming-policy.sh');
  const requestsScript = await readFile(new URL('../../../stackarr/scripts/requests.sh', import.meta.url), 'utf8');
  const helper = functionRange(requestsScript, 'build_seerr_service_payload', 'apply_seerr_main_preset');

  try {
    await writeFile(
      harness,
      [
        '#!/bin/bash',
        'set -euo pipefail',
        `REQUESTS_CONFIG_FILE=${JSON.stringify(fileURLToPath(requestsConfigUrl))}`,
        `NAMING_CONFIG_FILE=${JSON.stringify(fileURLToPath(namingConfigUrl))}`,
        helper,
        `build_seerr_service_payload tv '${JSON.stringify([{ id: 7, name: 'HD Lite', is4k: false, enableSeasonFolders: false }])}'`,
        ''
      ].join('\n')
    );
    const { stdout } = await execFile('bash', [harness], { cwd: repoRoot, env: process.env });
    const services = JSON.parse(stdout) as Array<Record<string, unknown>>;

    assert.equal(services[0]?.enableSeasonFolders, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('naming apply reconciles saved request-manager Sonarr defaults', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-request-manager-naming-'));
  const harness = path.join(root, 'request-manager-naming.sh');
  const namingScript = await readFile(new URL('../../../stackarr/scripts/naming.sh', import.meta.url), 'utf8');
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    let rawBody = '';
    for await (const chunk of request) rawBody += String(chunk);
    assert.equal(request.headers['x-api-key'], 'fixture-key');
    response.setHeader('content-type', 'application/json');

    if (request.method === 'GET' && request.url === '/v1/sonarr/instances') {
      response.end(JSON.stringify([{ id: 2, name: 'Sonarr', createSeasonFolders: false }]));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/v1/settings/sonarr') {
      response.end(JSON.stringify([{ id: 4, name: 'Sonarr', enableSeasonFolders: false }]));
      return;
    }
    if (request.method === 'PUT') {
      writes.push({ path: request.url || '', body: JSON.parse(rawBody) });
      response.end('{}');
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const helper = functionRange(
      namingScript,
      'reconcile_request_manager_season_folders',
      'apply_request_manager_season_folder_policies'
    );
    await writeFile(
      harness,
      [
        '#!/bin/bash',
        'set -euo pipefail',
        'ok() { :; }',
        'warn() { :; }',
        `NAMING_CONFIG_FILE=${JSON.stringify(fileURLToPath(namingConfigUrl))}`,
        'tv_season_folders_enabled() { printf "true\\n"; }',
        helper,
        'reconcile_request_manager_season_folders "Pulsarr" "$BASE_URL" "/v1/sonarr/instances" fixture-key createSeasonFolders',
        'reconcile_request_manager_season_folders "Agregarr" "$BASE_URL" "/api/v1/settings/sonarr" fixture-key enableSeasonFolders',
        ''
      ].join('\n')
    );
    await execFile('bash', [harness], {
      cwd: repoRoot,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}` }
    });

    assert.deepEqual(writes, [
      {
        path: '/v1/sonarr/instances/2',
        body: { id: 2, name: 'Sonarr', createSeasonFolders: true }
      },
      {
        path: '/api/v1/settings/sonarr/4',
        body: { id: 4, name: 'Sonarr', enableSeasonFolders: true }
      }
    ]);
  } finally {
    if (server.listening) server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Radarr naming emits Plex movie edition tags from the current edition token', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));

  assert.equal(naming.radarr.movieFolderFormat, '{Movie Title} ({Release Year})');
  assert.equal(
    naming.radarr.standardMovieFormat,
    '{Movie Title} ({Release Year}) {edition-{Edition Tags}} [{Quality Full}.{MediaInfo VideoCodec}.{MediaInfo AudioCodec}.{MediaInfo AudioChannels}]'
  );
  assert.doesNotMatch(JSON.stringify(naming.radarr), /Movie Edition/);
});

test('tinyMediaManager preserves explicitly edition-tagged TV show folders', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));

  assert.equal(naming.tinymediamanager.tvShows.renamerTvShowFoldername, '');
});

test('tinyMediaManager preserves a Plex movie edition marker when its edition field is empty', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));
  const movieFilenamePattern = naming.tinymediamanager.movies.renamerFilename;

  assert.equal(naming.tinymediamanager.movies.renamerPathname, '${title} (${year})');
  assert.match(movieFilenamePattern, /\$\{if edition\} \{edition-\$\{edition\}\}\$\{else\}/);
  assert.match(
    movieFilenamePattern,
    /\$\{@regexp \(\?i\)\(\\x20\\x7Bedition-\[\^\\x7D\]\+\\x7D\) movie\.mainVideoFile\.filename \$1\}/
  );
});
