import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readJsonSetting, writeJsonSetting } from '../../core/src/database';

const stateDir = mkdtempSync(path.join(tmpdir(), 'stackarr-streamrip-test-'));
process.env.STACKARR_DATABASE_FILE = path.join(stateDir, 'stackarr.db');
process.env.STREAMRIP_STATE_ROOT = path.join(stateDir, 'streamrip-state');

function core() {
  return import('../../core/src/index.ts');
}

test('Streamrip config exposes typed fields and redacts secrets', async () => {
  const { getServiceConfigAction, updateStreamripConfigAction, getStreamripConfigAction, renderStreamripToml } =
    await core();

  const model = getServiceConfigAction({ service: 'streamrip' });
  assert.ok('groups' in model);
  assert.ok(typeof model.service !== 'string');
  assert.equal(model.service.name, 'streamrip');
  assert.equal(model.groups.length, 15);

  const deezer = model.groups.find((group) => group.title === 'Deezer');
  assert.ok(deezer);
  assert.equal(deezer.fields.find((field) => field.id === 'deezer.quality')?.type, 'select');
  assert.equal(deezer.fields.find((field) => field.id === 'deezer.arl')?.type, 'password');
  assert.equal(deezer.fields.find((field) => field.id === 'deezer.arl')?.secret, true);

  const qobuz = model.groups.find((group) => group.title === 'Qobuz');
  assert.ok(qobuz);
  assert.equal(qobuz.fields.find((field) => field.id === 'qobuz.secrets')?.secret, true);

  const artwork = model.groups.find((group) => group.title === 'Artwork');
  assert.ok(artwork);
  assert.equal(artwork.fields.find((field) => field.id === 'artwork.embed_size')?.type, 'select');

  updateStreamripConfigAction({
    values: {
      'deezer.arl': 'secret-cookie',
      'deezer.quality': '1',
      'qobuz.secrets': ['qobuz-secret-one', 'qobuz-secret-two'],
      'artwork.embed_size': 'large',
      'database.downloads_path': path.join(stateDir, 'streamrip-state', 'downloads.db'),
      'database.failed_downloads_path': path.join(stateDir, 'streamrip-state', 'failed_downloads.db'),
      'conversion.enabled': true
    }
  });
  const publicConfig = getStreamripConfigAction().config;
  assert.equal(publicConfig.deezer.arl, '********');
  assert.equal(publicConfig.qobuz.secrets, '********');
  assert.equal(publicConfig.deezer.quality, 1);
  assert.equal(publicConfig.artwork.embed_size, 'large');
  assert.equal(publicConfig.conversion.enabled, true);
  assert.equal(publicConfig.database.downloads_path, path.join(stateDir, 'streamrip-state', 'downloads.db'));

  const toml = renderStreamripToml();
  assert.match(toml, /\[deezer\]/);
  assert.match(toml, /quality = 1/);
  assert.match(toml, /arl = "secret-cookie"/);
  assert.match(toml, /secrets = \["qobuz-secret-one", "qobuz-secret-two"\]/);
  assert.match(toml, /embed_size = "large"/);

  const stored = readJsonSetting<Record<string, Record<string, unknown>>>('stackarr.streamripConfig', {});
  assert.match(String(stored.deezer.arl), /^stackarr:v1:/);
  assert.match(String(stored.qobuz.secrets), /^stackarr:v1:/);
  assert.notEqual(stored.deezer.arl, 'secret-cookie');
  assert.notDeepEqual(stored.qobuz.secrets, ['qobuz-secret-one', 'qobuz-secret-two']);
});

test('Streamrip database paths must stay under the managed state root', async () => {
  const { getStreamripConfigAction, updateStreamripConfigAction } = await core();

  assert.throws(
    () =>
      updateStreamripConfigAction({
        values: { 'database.downloads_path': path.join(stateDir, 'outside-downloads.db') }
      }),
    /managed Streamrip state root/
  );

  updateStreamripConfigAction({
    values: { 'database.downloads_path': path.join(stateDir, 'streamrip-state', 'nested', 'downloads.db') }
  });

  assert.equal(
    getStreamripConfigAction().config.database.downloads_path,
    path.join(stateDir, 'streamrip-state', 'downloads.db')
  );
});

test('audit redaction masks Streamrip field-id secrets', async () => {
  const { redactSecrets, redactString } = await core();

  assert.deepEqual(
    redactSecrets({
      values: {
        'deezer.arl': 'secret-cookie',
        'qobuz.app_id': 'app-secret',
        'soundcloud.client_id': 'client-secret',
        'deezer.quality': '1'
      }
    }),
    {
      values: {
        'deezer.arl': '********',
        'qobuz.app_id': '********',
        'soundcloud.client_id': '********',
        'deezer.quality': '1'
      }
    }
  );

  assert.equal(
    redactString('Authorization: Bearer abc.def API_KEY=visible PASSWORD: also-visible'),
    'Authorization=******** API_KEY=******** PASSWORD=********'
  );
});

test('Streamrip URL downloads reject non-provider and non-HTTPS URLs', async () => {
  const { startStreamripDownloadAction } = await core();

  await assert.rejects(
    () => startStreamripDownloadAction({ url: 'https://127.0.0.1/internal' }),
    /Qobuz, Tidal, Deezer, or SoundCloud/
  );
  await assert.rejects(() => startStreamripDownloadAction({ url: 'http://www.deezer.com/album/1' }), /must use HTTPS/);
  await assert.rejects(
    () => startStreamripDownloadAction({ url: 'https://www.qobuz.com:8443/album/test' }),
    /credentials or custom ports/
  );
});

test('Streamrip config normalizes copied Deezer ARL assignments', async () => {
  const { getStreamripConfigAction, updateStreamripConfigAction } = await core();

  updateStreamripConfigAction({ values: { 'deezer.arl': 'arl = "wrapped-cookie"' } });

  const publicConfig = getStreamripConfigAction().config;
  assert.equal(publicConfig.deezer.arl, '********');

  const stored = readJsonSetting<Record<string, Record<string, unknown>>>('stackarr.streamripConfig', {});
  assert.match(String(stored.deezer.arl), /^stackarr:v1:/);

  const { renderStreamripToml } = await core();
  assert.match(renderStreamripToml(), /arl = "wrapped-cookie"/);
});

test('Streamrip config ignores undecryptable restored secrets', async () => {
  const { getServiceConfigAction, getStreamripConfigAction } = await core();

  writeJsonSetting('stackarr.streamripConfig', {
    deezer: {
      arl: 'stackarr:v1:not-valid:not-valid:not-valid'
    }
  });

  const publicConfig = getStreamripConfigAction().config;
  assert.equal(publicConfig.deezer.arl, '');

  const model = getServiceConfigAction({ service: 'streamrip' });
  assert.ok('groups' in model);
  assert.equal(
    model.groups.find((group) => group.title === 'Deezer')?.fields.find((field) => field.id === 'deezer.arl')?.value,
    ''
  );
});

test('Streamrip reads a bounded page of missing Lidarr albums', async () => {
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({
      page: 1,
      pageSize: 60,
      totalRecords: 33057,
      records: [
        {
          id: 42,
          title: 'A Test Album',
          releaseDate: '2026-01-01',
          monitored: true,
          statistics: { percentOfTracks: 0, trackFileCount: 0, trackCount: 10 },
          artist: { id: 7, artistName: 'A Test Artist' }
        }
      ]
    });
  };

  try {
    const { listLidarrStreamripAlbumsAction, writeEnvConfig } = await core();
    writeEnvConfig({ LIDARR_URL: 'http://lidarr.invalid:8686', LIDARR_API_KEY: 'test-lidarr-key' });
    const result = await listLidarrStreamripAlbumsAction({ limit: 60, offset: 0 });

    assert.equal(result.albums.length, 1);
    assert.equal(result.total, 33057);
    assert.equal(result.hasMore, true);
    assert.equal(requests.length, 1);
    const request = new URL(requests[0]!);
    assert.equal(request.pathname, '/api/v1/wanted/missing');
    assert.equal(request.searchParams.get('pageSize'), '60');
    assert.equal(request.searchParams.get('includeArtist'), 'true');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
