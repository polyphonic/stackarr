import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readJsonSetting } from '../../core/src/database';

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

  const artwork = model.groups.find((group) => group.title === 'Artwork');
  assert.ok(artwork);
  assert.equal(artwork.fields.find((field) => field.id === 'artwork.embed_size')?.type, 'select');

  updateStreamripConfigAction({
    values: {
      'deezer.arl': 'secret-cookie',
      'deezer.quality': '1',
      'artwork.embed_size': 'large',
      'database.downloads_path': '/repo/state/streamrip/downloads.db',
      'database.failed_downloads_path': '/repo/state/streamrip/failed_downloads.db',
      'conversion.enabled': true
    }
  });
  const publicConfig = getStreamripConfigAction().config;
  assert.equal(publicConfig.deezer.arl, '********');
  assert.equal(publicConfig.deezer.quality, 1);
  assert.equal(publicConfig.artwork.embed_size, 'large');
  assert.equal(publicConfig.conversion.enabled, true);
  assert.equal(publicConfig.database.downloads_path, path.join(stateDir, 'streamrip-state', 'downloads.db'));

  const toml = renderStreamripToml();
  assert.match(toml, /\[deezer\]/);
  assert.match(toml, /quality = 1/);
  assert.match(toml, /arl = "secret-cookie"/);
  assert.match(toml, /embed_size = "large"/);

  const stored = readJsonSetting<Record<string, Record<string, unknown>>>('stackarr.streamripConfig', {});
  assert.match(String(stored.deezer.arl), /^stackarr:v1:/);
  assert.notEqual(stored.deezer.arl, 'secret-cookie');
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
