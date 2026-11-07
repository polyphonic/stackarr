import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceApiKey } from '../../core/src/clients/serviceConfig';
import type { StackarrEnv } from '../../core/src/env';
import { discoverServiceStorage } from '../../core/src/serviceStorage';
import { servicesFromEnv } from '../../core/src/services';

const fixture = {
  APP_ROOT: '/fixture/app',
  CONFIG_ROOT: '/fixture/config',
  STATE_ROOT: '/fixture/state',
  LOG_ROOT: '/fixture/log',
  BACKUP_ROOT: '/fixture/backups',
  ENABLE_BACKUP: 'false',
  PLEX_INSTALL_MODE: 'disabled',
  JELLYFIN_INSTALL_MODE: 'disabled',
  ENABLE_IMMICH: 'true',
  IMMICH_UPLOAD_LOCATION: '/fixture/photos'
} as StackarrEnv;

test('host registry uses supplied env without runtime settings reads', () => {
  const services = servicesFromEnv(fixture);
  assert.equal(services.find((s) => s.name === 'immich')?.mode, 'docker');
  assert.equal(services.find((s) => s.name === 'backup')?.mode, 'disabled');
  assert.equal(services.find((s) => s.name === 'immich')?.configPath, '/fixture/photos');
  assert.equal(serviceApiKey('plex', { PLEX_API_KEY: 'fixture-key' } as StackarrEnv), 'fixture-key');
});

test('supplied services and env preserve disabled-backup association and discovery issues', async () => {
  let resolverCalled = false;
  const services = servicesFromEnv(fixture);
  const report = await discoverServiceStorage(
    fixture,
    {
      services: () => {
        resolverCalled = true;
        throw new Error('DB registry must not run');
      },
      containers: async () => {
        throw new Error('docker unavailable');
      },
      libraries: async () => []
    },
    services
  );
  assert.equal(resolverCalled, false);
  assert.deepEqual(report.issues, [{ service: 'docker', status: 'discovery-unavailable' }]);
  assert.ok(report.roots.some((r) => r.path === '/fixture/backups' && r.service === 'backup'));
  assert.ok(report.roots.some((r) => r.path === '/fixture/photos' && r.service === 'immich'));
  assert.ok(!report.roots.some((r) => r.path === '/fixture/unrelated'));
});
