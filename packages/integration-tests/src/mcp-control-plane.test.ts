import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getMcpToolCatalog,
  isControlPlaneBoundaryConfigKey,
  isCredentialConfigKey,
  resolveMcpGroups,
  resolveMcpProfile
} from '@stackarr/core';

const enabledServices = [
  'stackarr',
  'transmission',
  'prowlarr',
  'radarr',
  'sonarr',
  'plex',
  'seerr',
  'streamrip',
  'lidarr'
];

test('MCP profiles narrow authority without allowing in-band promotion', () => {
  assert.equal(resolveMcpProfile(undefined), 'manage');
  assert.equal(resolveMcpProfile('ADMIN'), 'admin');
  assert.equal(resolveMcpProfile('unknown'), 'manage');

  const observe = getMcpToolCatalog({ profile: 'observe', enabledServices });
  const manage = getMcpToolCatalog({ profile: 'manage', enabledServices });
  const admin = getMcpToolCatalog({ profile: 'admin', enabledServices });

  assert.ok(observe.every((tool) => tool.risk === 'read'));
  assert.ok(manage.some((tool) => tool.name === 'stackarr_add_movie'));
  assert.ok(manage.some((tool) => tool.name === 'stackarr_remove_download'));
  assert.ok(!manage.some((tool) => tool.name === 'stackarr_update_stack_config'));
  assert.ok(!manage.some((tool) => tool.name === 'stackarr_update_streamrip_config'));
  assert.ok(!manage.some((tool) => tool.name === 'stackarr_restore_backup'));
  assert.ok(!manage.some((tool) => tool.name === 'stackarr_manage_container_resource'));
  assert.ok(!manage.some((tool) => tool.name === 'stackarr_remove_docker_volume'));
  assert.ok(admin.some((tool) => tool.name === 'stackarr_update_stack_config'));
  assert.ok(admin.some((tool) => tool.name === 'stackarr_manage_container_resource'));
  assert.ok(admin.some((tool) => tool.name === 'stackarr_remove_docker_volume'));
});

test('MCP catalog removes actions for services that are not installed', () => {
  const tools = getMcpToolCatalog({
    profile: 'manage',
    enabledServices: ['stackarr', 'transmission', 'radarr', 'prowlarr']
  });

  assert.ok(tools.some((tool) => tool.name === 'stackarr_add_movie'));
  assert.ok(tools.some((tool) => tool.name === 'stackarr_search_releases'));
  assert.ok(!tools.some((tool) => tool.category === 'plex'));
  assert.ok(!tools.some((tool) => tool.category === 'seerr'));
  assert.ok(!tools.some((tool) => tool.category === 'apps'));
  assert.ok(!tools.some((tool) => tool.name === 'stackarr_add_series'));
  assert.ok(!tools.some((tool) => tool.name.includes('streamrip')));
});

test('MCP catalog stays focused until onboarding selects apps', () => {
  const tools = getMcpToolCatalog({ profile: 'manage', enabledServices: ['stackarr'] });

  assert.ok(tools.some((tool) => tool.name === 'stackarr_get_setup_profile'));
  assert.ok(tools.some((tool) => tool.name === 'stackarr_get_mcp_connection_kit'));
  assert.ok(tools.some((tool) => tool.name === 'stackarr_get_system_status'));
  assert.ok(!tools.some((tool) => tool.category === 'arr'));
  assert.ok(!tools.some((tool) => tool.category === 'downloads'));
  assert.ok(!tools.some((tool) => tool.category === 'plex'));
  assert.ok(!tools.some((tool) => tool.category === 'seerr'));
  assert.ok(!tools.some((tool) => tool.category === 'backups'));
});

test('MCP groups let small-model clients load only relevant action families', () => {
  assert.deepEqual(resolveMcpGroups('stack,downloads,unknown'), ['stack', 'downloads']);
  const tools = getMcpToolCatalog({
    profile: 'manage',
    enabledServices,
    groups: ['stack', 'downloads']
  });

  assert.ok(tools.length > 0);
  assert.ok(tools.every((tool) => tool.category === 'stack' || tool.category === 'downloads'));
  assert.ok(!tools.some((tool) => tool.category === 'arr'));
});

test('native app tools appear as one compact group only when a supported app is enabled', () => {
  const withoutNativeApps = enabledServices.filter((service) => service !== 'lidarr');
  const withoutApps = getMcpToolCatalog({ profile: 'manage', enabledServices: withoutNativeApps });
  const withImmich = getMcpToolCatalog({ profile: 'manage', enabledServices: [...withoutNativeApps, 'immich'] });
  const withPulsarr = getMcpToolCatalog({ profile: 'manage', enabledServices: [...withoutNativeApps, 'pulsarr'] });

  assert.ok(!withoutApps.some((tool) => tool.category === 'apps'));
  assert.deepEqual(
    withImmich.filter((tool) => tool.category === 'apps').map((tool) => tool.name),
    ['stackarr_get_app_capabilities', 'stackarr_read_app', 'stackarr_manage_app', 'stackarr_administer_app']
  );
  assert.deepEqual(
    withPulsarr.filter((tool) => tool.name.includes('_pulsarr_')).map((tool) => tool.name),
    [
      'stackarr_list_pulsarr_users',
      'stackarr_get_pulsarr_user_diagnostics',
      'stackarr_set_pulsarr_user_sync',
      'stackarr_set_pulsarr_user_quotas'
    ]
  );
});

test('control-plane endpoints are protected separately from credentials', () => {
  assert.equal(isControlPlaneBoundaryConfigKey('RADARR_URL'), true);
  assert.equal(isControlPlaneBoundaryConfigKey('STACKARR_BIND_IP'), true);
  assert.equal(isControlPlaneBoundaryConfigKey('SONARR_IMAGE'), true);
  assert.equal(isControlPlaneBoundaryConfigKey('RADARR_API_KEY'), false);
  assert.equal(isCredentialConfigKey('RADARR_API_KEY'), true);
  assert.equal(isCredentialConfigKey('PASSWORD'), true);
});
