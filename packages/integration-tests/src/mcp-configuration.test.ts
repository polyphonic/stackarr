import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Run only with TMPDIR on UUID-verified disposable Media storage.
test('generic MCP mutations fail closed before initialization or file changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-configuration-'));
  const original = process.env.STACKARR_DATABASE_FILE;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');
  try {
    const actions = await import('../../mcp/src/configurationControl');
    for (const confirm of [false, true]) {
      for (const result of [
        actions.updateSafeStackConfigurationAction({ confirm, config: { STACKARR_PG_BACKUP_ENABLED: 'true' } }),
        actions.updateSafeServiceConfigurationAction({ confirm, service: 'stackarr', values: { ENABLE_ROMM: true } }),
        actions.previewServiceConfigurationAction({ service: 'stackarr', values: { ENABLE_ROMM: true } })
      ]) {
        assert.equal(result.accepted, false);
        assert.match(result.error, /capability unavailable/i);
      }
    }
    await assert.rejects(stat(process.env.STACKARR_DATABASE_FILE), /ENOENT/);
    const { credentialKeysInConfigurationCall } = await import('../../mcp/src/registry');
    assert.deepEqual(
      credentialKeysInConfigurationCall('stackarr_update_stack_config', {
        config: { PASSWORD: 'fixture-only' },
        currentPassword: 'fixture-only'
      }),
      ['config.PASSWORD', 'currentPassword']
    );
    assert.deepEqual(
      credentialKeysInConfigurationCall('stackarr_update_stack_config', {
        config: { innocent: { endpoint: 'postgres://fixture:fixture-only@example.invalid/db' } }
      }),
      ['config.innocent.endpoint']
    );
    assert.deepEqual(
      credentialKeysInConfigurationCall('stackarr_update_service_config', {
        values: { nested: { apiKey: 'fixture-only' } }
      }),
      ['nested.apiKey']
    );
    assert.deepEqual(
      credentialKeysInConfigurationCall('stackarr_update_streamrip_config', {
        values: { 'deezer.arl': 'fixture-only' }
      }),
      ['deezer.arl']
    );
    for (const read of [
      actions.discoverConfigurationAction,
      actions.readConfigurationAction,
      actions.getNativeDatabaseGuidanceAction
    ])
      assert.throws(read, /not initialized/);
    for (const input of [
      { config: { STACKARR_PG_BACKUP_ENABLED: 'true' } },
      { config: { ENABLE_BACKUP: 'true' } },
      { currentPassword: 'fixture-only' },
      { settings: { host: { port: 1234 } } },
      { settings: { telemetry: { enabled: true } } }
    ])
      assert.throws(() => actions.previewStackConfigurationAction(input), /unavailable|not initialized/);
    await assert.rejects(stat(process.env.STACKARR_DATABASE_FILE), /ENOENT/);

    const core = await import('@stackarr/core');
    core.writeEnvConfig({
      PASSWORD: 'fixture-only',
      STACKARR_PG_BACKUP_ENABLED: 'false',
      STACKARR_PG_BACKUP_URL: 'postgres://fixture:***@example.invalid/archive'
    });
    const env = core.readEnv();
    const settings = core.readSettings();
    // Fixture initialization above may seed defaults; snapshot only after it finishes.
    const before = await readFile(process.env.STACKARR_DATABASE_FILE);
    const inventory = actions.discoverConfigurationAction();
    assert.equal(
      inventory.env.find((field) => field.key === 'STACKARR_PG_BACKUP_ENABLED')?.write,
      'generic-mcp-unavailable'
    );
    assert.equal(inventory.services.length, 0);
    assert.equal(inventory.settings.host.find((field) => field.key === 'port')?.write, 'generic-mcp-unavailable');
    const read = actions.readConfigurationAction();
    assert.equal(read.env.PASSWORD, '********');
    assert.equal(read.env.STACKARR_PG_BACKUP_URL, '********');
    assert.ok(!JSON.stringify(read).includes('fixture-only'));
    assert.ok(!JSON.stringify(read).includes('example.invalid'));
    assert.equal(actions.getNativeDatabaseGuidanceAction().backupCoverage.remoteArchiveEnabled, false);
    const preview = actions.previewStackConfigurationAction({
      settings: { ui: { showAdvanced: !settings.ui.showAdvanced } }
    });
    assert.equal(preview.provisional, true);
    assert.equal(preview.confirmationRequired, false);
    assert.deepEqual(preview.changedSettings, ['ui.showAdvanced']);
    for (const input of [
      { config: { STACKARR_PG_BACKUP_ENABLED: 'true' } },
      { config: { PASSWORD: 'secret' } },
      { currentPassword: 'fixture-only', settings: { ui: { showAdvanced: true } } },
      { settings: { host: { port: 1234 } } },
      { settings: { telemetry: { enabled: true } } }
    ])
      assert.throws(() => actions.previewStackConfigurationAction(input), /unavailable|Unsupported/);
    assert.equal(
      actions.updateSafeStackConfigurationAction({ confirm: true, settings: { ui: { showAdvanced: true } } }).accepted,
      false
    );
    assert.equal(
      actions.updateSafeServiceConfigurationAction({ confirm: true, service: 'stackarr', values: { enabled: true } })
        .accepted,
      false
    );
    assert.deepEqual(core.readEnv(), env);
    assert.deepEqual(core.readSettings(), settings);
    assert.deepEqual(await readFile(process.env.STACKARR_DATABASE_FILE), before);
  } finally {
    if (original === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = original;
    await rm(root, { recursive: true, force: true });
  }
});
