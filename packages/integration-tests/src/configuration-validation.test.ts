import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateConfigurationPatch,
  validateTelemetryConsent,
  withGeneratedOptionalSecrets
} from '../../core/src/configurationValidation';
import { managedEnvDefaults, type StackarrEnv } from '../../core/src/env';
import { stackarrToolCatalog } from '../../core/src/mcp/toolCatalog';

test('shared route preflight rejects retained external managed ports before saving', () => {
  const current = { ...managedEnvDefaults };
  const patches: StackarrEnv[] = [
    { RADARR_POSTGRES_PORT: '5439' },
    { TRACEARR_DATABASE_URL: 'postgres://tracearr:fixture@database:5439/tracearr' },
    { POSTGRES_DEPLOYMENT_MODE: 'external', POSTGRES_HOST: 'localhost', POSTGRES_PORT: '5432' }
  ];
  for (const patch of patches) {
    const result = validateConfigurationPatch(patch, current);
    assert.equal(result?.status, 400);
    assert.match(result?.error ?? '', /port|host|endpoint/i);
  }
  assert.deepEqual(current, managedEnvDefaults);
});

test('shared route preflight retains protected and backup configuration guards', () => {
  const current = { ...managedEnvDefaults, PASSWORD: 'fixture-only' };
  assert.equal(validateConfigurationPatch({ PASSWORD: 'another-fixture' }, current)?.status, 403);
  assert.equal(validateConfigurationPatch({ STACKARR_PG_BACKUP_ENABLED: 'true' }, current)?.status, 400);
  assert.equal(
    validateConfigurationPatch({ ENABLE_ROMM: 'true', ROMM_WEB_SERVER_CONCURRENCY: '99' }, current)?.status,
    400
  );
  assert.equal(
    validateTelemetryConsent(false, true, undefined),
    'Explicit confirmation is required to enable anonymous usage data.'
  );
  assert.equal(validateTelemetryConsent(false, true, true), null);
});

test('external Tracearr URL survives generated config without changing the managed default', () => {
  const current = { ...managedEnvDefaults, ENABLE_TRACEARR: 'true' };
  const external = withGeneratedOptionalSecrets(
    {
      POSTGRES_DEPLOYMENT_MODE: 'external',
      POSTGRES_HOST: 'db.example.invalid',
      POSTGRES_PORT: '5439',
      TRACEARR_DATABASE_URL: 'postgres://tracearr:fixture@db.example.invalid:5439/tracearr?sslmode=require'
    },
    current
  );
  assert.equal(
    external.TRACEARR_DATABASE_URL,
    'postgres://tracearr:fixture@db.example.invalid:5439/tracearr?sslmode=require'
  );
  const managed = withGeneratedOptionalSecrets({}, current);
  assert.equal(new URL(managed.TRACEARR_DATABASE_URL).hostname, 'database');
});

test('MCP catalog advertises read-only preview and fail-closed generic writes', () => {
  const byName = (name: string) => stackarrToolCatalog.find((entry) => entry.name === name);
  for (const name of [
    'stackarr_discover_configuration',
    'stackarr_read_configuration',
    'stackarr_preview_stack_configuration',
    'stackarr_get_native_database_guidance'
  ]) {
    assert.equal(byName(name)?.risk, 'read');
  }
  for (const name of ['stackarr_update_stack_config', 'stackarr_update_service_config']) {
    assert.match(byName(name)?.description ?? '', /unavailable/i);
  }
});
