import { getServices } from '../services';
import { readSettings } from '../settings';
import { stackarrToolCatalog } from './toolCatalog';
import type { McpProfile, ToolCatalogEntry, ToolCategory } from './types';

type ServiceRequirement = {
  allOf?: string[];
  anyOf?: string[];
  anyOfEach?: string[][];
};

const appActionCategories = new Set([
  'apps',
  'automations',
  'arr',
  'releases',
  'downloads',
  'plex',
  'seerr',
  'backups',
  'health'
]);
const adminOnlyTools = new Set([
  'stackarr_restore_backup',
  'stackarr_restore_service_database_from_backup',
  'stackarr_update_streamrip_config',
  'stackarr_get_connection_policies',
  'stackarr_create_connection_policy',
  'stackarr_update_connection_policy',
  'stackarr_rotate_connection_token'
]);
const arrServices = ['sonarr', 'sonarr4k', 'radarr', 'radarr4k'];
const seriesServices = ['sonarr', 'sonarr4k'];
const movieServices = ['radarr', 'radarr4k'];
const downloaderServices = ['transmission', 'qbittorrent'];
const nativeAppServices = [
  'jellyfin',
  'immich',
  'pulsarr',
  'maintainerr',
  'agregarr',
  'tracearr',
  'romm',
  'bookorbit',
  'bazarr',
  'lidarr',
  'tinymediamanager',
  'recyclarr',
  'flaresolverr',
  'tidarr'
];
const toolCategories: ToolCategory[] = [
  'stack',
  'services',
  'apps',
  'automations',
  'connections',
  'containers',
  'arr',
  'releases',
  'downloads',
  'plex',
  'seerr',
  'backups',
  'health'
];

export function resolveMcpProfile(value = process.env.STACKARR_MCP_PROFILE): McpProfile {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'observe' || normalized === 'manage' || normalized === 'admin' || normalized === 'unrestricted') {
    return normalized;
  }

  return 'manage';
}

export function getMcpProfileDescription(profile: McpProfile) {
  switch (profile) {
    case 'observe':
      return 'Read-only status, diagnostics, and library inspection.';
    case 'manage':
      return 'Read access plus native media, request, download, backup, and safe repair actions.';
    case 'admin':
      return 'The complete Stackarr control plane, with interactive approval for destructive actions.';
    case 'unrestricted':
      return 'The complete Stackarr control plane without per-action approval prompts.';
  }
}

export function resolveMcpGroups(value = process.env.STACKARR_MCP_GROUPS): ToolCategory[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const requested = new Set(value.split(',').map((group) => group.trim().toLowerCase()));
  return toolCategories.filter((group) => requested.has(group));
}

export function getEnabledMcpServiceNames() {
  return getMcpServiceSelection().enabledServices;
}

export function getMcpServiceSelection() {
  const onboardingComplete = readSettings().setup.onboardingComplete;

  if (!onboardingComplete) {
    return {
      onboardingComplete,
      catalogMode: 'setup' as const,
      enabledServices: ['stackarr']
    };
  }

  return {
    onboardingComplete,
    catalogMode: 'configured-services' as const,
    enabledServices: getServices()
      .filter((service) => service.mode !== 'disabled')
      .map((service) => service.name)
  };
}

export function getMcpToolCatalog(
  options: { profile?: McpProfile; enabledServices?: Iterable<string>; groups?: Iterable<ToolCategory> } = {}
) {
  const profile = options.profile ?? resolveMcpProfile();
  const enabledServices = new Set(options.enabledServices ?? getEnabledMcpServiceNames());
  const configuredGroups = options.groups ?? resolveMcpGroups();
  const groups = configuredGroups ? new Set(configuredGroups) : undefined;

  return stackarrToolCatalog.filter(
    (tool) =>
      tool.enabledForLocalMcp &&
      (!groups || groups.has(tool.category)) &&
      isToolEnabledForProfile(tool, profile) &&
      isToolRelevant(tool, enabledServices)
  );
}

export function isToolEnabledForProfile(tool: ToolCatalogEntry, profile: McpProfile) {
  if (profile === 'admin' || profile === 'unrestricted') {
    return true;
  }

  if (adminOnlyTools.has(tool.name)) return false;

  if (profile === 'observe') {
    return tool.risk === 'read';
  }

  return tool.risk === 'read' || (appActionCategories.has(tool.category) && !adminOnlyTools.has(tool.name));
}

export function getToolServiceRequirement(tool: ToolCatalogEntry): ServiceRequirement | undefined {
  const { name, category } = tool;

  if (category === 'plex') return { anyOf: ['plex'] };
  if (category === 'apps') {
    if (name.includes('_lidarr_')) return { allOf: ['lidarr'] };
    if (name.includes('_pulsarr_')) return { allOf: ['pulsarr'] };
    if (name.includes('_agregarr_')) return { allOf: ['agregarr'] };
    if (name.includes('_questarr_')) return { allOf: ['questarr'] };
    if (name.includes('_youtarr_')) return { allOf: ['youtarr'] };
    return { anyOf: nativeAppServices };
  }
  if (category === 'seerr') return { anyOf: ['seerr'] };
  if (category === 'releases') return { anyOf: ['prowlarr'] };
  if (category === 'backups') return { anyOf: ['backup'] };

  if (category === 'arr') {
    if (name.includes('series') || name.includes('episodes')) return { anyOf: seriesServices };
    if (name.includes('movie')) return { anyOf: movieServices };
    return { anyOf: arrServices };
  }

  if (category === 'downloads') {
    if (name.includes('lidarr_streamrip')) return { allOf: ['lidarr', 'streamrip'] };
    if (name.includes('streamrip')) return { allOf: ['streamrip'] };
    return { anyOf: downloaderServices };
  }

  if (name === 'stackarr_check_service_databases') return { allOf: ['database'] };
  if (name === 'stackarr_test_indexers') return { allOf: ['prowlarr'] };
  if (name === 'stackarr_test_arr_to_downloader') return { anyOfEach: [arrServices, downloaderServices] };
  if (name === 'stackarr_test_prowlarr_to_arr') return { allOf: ['prowlarr'], anyOf: arrServices };
  if (name === 'stackarr_test_seerr_to_arr') return { allOf: ['seerr'], anyOf: arrServices };
  if (name === 'stackarr_test_plex_identity') return { allOf: ['plex'] };

  return undefined;
}

function isToolRelevant(tool: ToolCatalogEntry, enabledServices: Set<string>) {
  const requirement = getToolServiceRequirement(tool);
  if (!requirement) return true;

  const allAvailable = (requirement.allOf ?? []).every((service) => enabledServices.has(service));
  const anyAvailable = !requirement.anyOf?.length || requirement.anyOf.some((service) => enabledServices.has(service));
  const eachGroupAvailable = (requirement.anyOfEach ?? []).every((group) =>
    group.some((service) => enabledServices.has(service))
  );
  return allAvailable && anyAvailable && eachGroupAvailable;
}
