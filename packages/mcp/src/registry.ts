import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  addMagnetAction,
  addMovieAction,
  addReleaseToDownloaderAction,
  addSeriesAction,
  addTorrentUrlAction,
  administerNativeAppAction,
  applySafeFixAction,
  approveRequestAction,
  auditFinished,
  auditStarted,
  cancelStreamripJobAction,
  checkServiceDatabasesAction,
  createMcpConnectionPolicyAction,
  createRequestAction,
  DangerousActionError,
  declineRequestAction,
  deleteRoutineAction,
  diagnoseServiceAction,
  downloadLidarrAlbumWithStreamripAction,
  getArrQueueAction,
  getBackupStatusAction,
  getCloudflareAccessAction,
  getCloudflareRoutesAction,
  getCommonIssuesAction,
  getDiskUsageAction,
  getDockerOverviewAction,
  getDownloadHistoryAction,
  getDownloadQueueAction,
  getEnabledMcpServiceNames,
  getIndexerStatusAction,
  getMcpConnectionKit,
  getMcpProfileDescription,
  getMcpServiceSelection,
  getMcpToolCatalog,
  getMediaServerSetupProfileAction,
  getMissingEpisodesAction,
  getMovieStatusAction,
  getNativeAppCapabilitiesAction,
  getPlexLibrariesAction,
  getPlexServerStatusAction,
  getPlexSessionsAction,
  getPlexWatchSummaryAction,
  getRecentlyAddedAction,
  getRecentlyWatchedAction,
  getRequestStatusAction,
  getRequestsAction,
  getRoutinesAction,
  getSeriesStatusAction,
  getServiceConfigAction,
  getServiceStatusAction,
  getStackConfigSummaryAction,
  getStalledDownloadsAction,
  getStreamripConfigAction,
  getSystemStatusAction,
  getTelemetryStatusAction,
  getWantedMoviesAction,
  listAgentActivityRecords,
  listBackupsAction,
  listLidarrStreamripAlbumsAction,
  listMcpConnectionPoliciesAction,
  listServiceConfigsAction,
  listServicesAction,
  listStreamripJobsAction,
  type McpProfile,
  manageDockerResourceAction,
  manageNativeAppAction,
  migrateCurrentStackAction,
  monitorMovieAction,
  monitorSeriesAction,
  pauseDownloadAction,
  prepareLidarrStreamripAlbumAction,
  previewTelemetryPayloadAction,
  readNativeAppAction,
  readTasks,
  redactSecrets,
  refreshArrItemAction,
  refreshPlexMetadataAction,
  removeDownloadAction,
  resolveMcpGroups,
  resolveMcpProfile,
  restoreBackupAction,
  restoreServiceDatabaseFromBackupAction,
  resumeDownloadAction,
  rotateMcpConnectionPolicyTokenAction,
  runBackupWorkflowAction,
  runDoctorAction,
  runPermissionsAuditAction,
  runPermissionsFixAction,
  runRoutineAction,
  runUpdateAction,
  saveRoutineAction,
  scanPlexLibraryAction,
  searchMovieAction,
  searchReleasesAction,
  searchSeriesAction,
  sendTelemetryAction,
  setDownloadPriorityAction,
  setupMediaServerAction,
  startStackAction,
  startStreamripDownloadAction,
  startStreamripSearchDownloadAction,
  stopStackAction,
  type ToolCatalogEntry,
  type ToolCategory,
  testArrToDownloaderAction,
  testIndexersAction,
  testPlexIdentityAction,
  testProwlarrToArrAction,
  testSeerrToArrAction,
  testServiceApiAction,
  testServiceConnectivityAction,
  testStreamripAction,
  triggerArrSearchAction,
  unmonitorMovieAction,
  unmonitorSeriesAction,
  updateCloudflareAccessAction,
  updateCloudflareRoutesAction,
  updateMcpConnectionPolicyAction,
  updateServiceConfigAction,
  updateStackConfigAction,
  updateStreamripConfigAction,
  updateTelemetryConfigAction,
  validateBackupAction,
  validateSqliteDbAction
} from '@stackarr/core';
import { z } from 'zod';
import { serializeError } from './errors';
import { jsonContent } from './format';

type Handler = (input: any) => Promise<unknown> | unknown;
type ToolDef = { name: string; description: string; shape: z.ZodRawShape; handler: Handler };
const empty = {};
const service = { service: z.string() };
const dangerous = { reason: z.string().optional() };
const downloader = { downloader: z.enum(['transmission', 'qbittorrent']).optional() };
const seriesInstance = z.enum(['sonarr', 'sonarr4k']);
const movieInstance = z.enum(['radarr', 'radarr4k']);
const arrInstance = z.enum(['sonarr', 'sonarr4k', 'radarr', 'radarr4k']);
const nativeApp = z.enum([
  'jellyfin',
  'immich',
  'pulsarr',
  'maintainerr',
  'tracearr',
  'romm',
  'bookorbit',
  'bazarr',
  'lidarr',
  'tinymediamanager',
  'recyclarr',
  'flaresolverr',
  'tidarr'
]);
const nativeAppOperation = {
  app: nativeApp,
  operation: z.string().min(1).max(80),
  libraryId: z.string().max(128).optional(),
  itemId: z.string().max(128).optional(),
  taskId: z.string().max(100).optional(),
  sessionId: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  days: z.number().int().min(1).max(365).optional(),
  scope: z.enum(['all', 'radarr', 'sonarr']).optional()
};
const routineStep = z.object({
  kind: z.enum(['read_app', 'manage_app']),
  app: nativeApp,
  operation: z.string().min(1),
  libraryId: z.string().optional()
});

const tools: ToolDef[] = [
  {
    name: 'stackarr_get_setup_profile',
    description: 'Get opinionated setup questions/defaults and browser port.',
    shape: empty,
    handler: getMediaServerSetupProfileAction
  },
  {
    name: 'stackarr_get_mcp_control_plane',
    description: 'Get the active MCP profile, approval mode, enabled services, and grouped tool catalog.',
    shape: empty,
    handler: (input) =>
      getRegisteredControlPlaneSummary(input.__stackarrCallerProfile, { groups: input.__stackarrGroups })
  },
  {
    name: 'stackarr_get_mcp_connection_kit',
    description:
      'Generate a copy-ready connection kit for Codex, Claude, LM Studio, ChatGPT, Hermes, OpenClaw, or another MCP client.',
    shape: {
      client: z.enum(['codex', 'claude', 'lmstudio', 'chatgpt', 'hermes', 'openclaw', 'generic']),
      profile: z.enum(['observe', 'manage', 'admin', 'unrestricted']).optional(),
      groups: z
        .array(
          z.enum([
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
          ])
        )
        .optional(),
      containerName: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
        .optional(),
      tunnelId: z
        .string()
        .regex(/^tunnel_[a-zA-Z0-9_-]+$/)
        .optional()
    },
    handler: (input) =>
      getMcpConnectionKit({
        client: input.client,
        profile: input.profile,
        groups: input.groups as ToolCategory[] | undefined,
        containerName: input.containerName,
        tunnelId: input.tunnelId
      })
  },
  {
    name: 'stackarr_setup_media_server',
    description:
      'Perform the full opinionated Stackarr setup workflow. Defaults to dryRun; execution asks the user for approval in the MCP client.',
    shape: {
      torrentClient: z.enum(['transmission', 'qbittorrent']).optional(),
      mediaRoot: z.string().optional(),
      musicRoot: z.string().optional(),
      downloadsRoot: z.string().optional(),
      backupRoot: z.string().optional(),
      backupRetentionCount: z.number().int().positive().optional(),
      plexInstallMode: z.enum(['disabled', 'existing', 'docker']).optional(),
      plexToken: z.string().optional(),
      jellyfinInstallMode: z.enum(['disabled', 'existing', 'docker']).optional(),
      enabledMediaTypes: z.array(z.enum(['movies', 'tv', 'music', 'books', 'photos', 'games'])).optional(),
      requestManagers: z.array(z.enum(['seerr', 'pulsarr'])).optional(),
      enabledServices: z
        .array(
          z.enum([
            'bazarr',
            'tinymediamanager',
            'lidarr',
            'bookorbit',
            'immich',
            'romm',
            'recyclarr',
            'flaresolverr',
            'tidarr',
            'maintainerr',
            'tracearr'
          ])
        )
        .optional(),
      enableMovies: z.boolean().optional(),
      enableTvShows: z.boolean().optional(),
      enable4kServarr: z.boolean().optional(),
      enableBazarr: z.boolean().optional(),
      enableLidarr: z.boolean().optional(),
      enableBookOrbit: z.boolean().optional(),
      enableImmich: z.boolean().optional(),
      enableRomm: z.boolean().optional(),
      enableTinyMediaManager: z.boolean().optional(),
      enableRecyclarr: z.boolean().optional(),
      enableFlaresolverr: z.boolean().optional(),
      enableTidarr: z.boolean().optional(),
      enableMaintainerr: z.boolean().optional(),
      enableTracearr: z.boolean().optional(),
      maintainerrCleanupPresets: z.array(z.enum(['watched-movies', 'abandoned-shows', 'stale-requests'])).optional(),
      movieProfilePreset: z.enum(['lite', 'balanced']).optional(),
      movie4kProfilePreset: z.enum(['lite', 'balanced']).optional(),
      tvProfilePreset: z.enum(['lite', 'balanced']).optional(),
      tv4kProfilePreset: z.enum(['lite', 'balanced']).optional(),
      musicProfilePreset: z.enum(['lossless', 'lossy']).optional(),
      movieDefaultProfile: z.string().optional(),
      movie4kDefaultProfile: z.string().optional(),
      tvDefaultProfile: z.string().optional(),
      tv4kDefaultProfile: z.string().optional(),
      musicDefaultProfile: z.string().optional(),
      enableRequestManagement: z.boolean().optional(),
      enableSeerr: z.boolean().optional(),
      enablePulsarr: z.boolean().optional(),
      globalUsername: z.string().optional(),
      globalPassword: z.string().optional(),
      globalEmail: z.string().email().optional().or(z.literal('')),
      seerrBindIp: z.string().optional(),
      transmissionBindIp: z.string().optional(),
      qbittorrentBindIp: z.string().optional(),
      webPort: z.number().optional(),
      installBackup: z.boolean().optional(),
      installUpdates: z.boolean().optional(),
      startStack: z.boolean().optional(),
      configureServices: z.boolean().optional(),
      applyPresets: z.boolean().optional(),
      openBrowser: z.boolean().optional(),
      dryRun: z.boolean().optional()
    },
    handler: (input) =>
      setupMediaServerAction({
        ...input,
        plexInstallMode: normalizeMcpMediaServerMode(input.plexInstallMode),
        jellyfinInstallMode: normalizeMcpMediaServerMode(input.jellyfinInstallMode)
      })
  },
  {
    name: 'stackarr_get_system_status',
    description: 'Get Stackarr system status.',
    shape: empty,
    handler: getSystemStatusAction
  },
  { name: 'stackarr_list_services', description: 'List Stackarr services.', shape: empty, handler: listServicesAction },
  {
    name: 'stackarr_get_service_status',
    description: 'Get service status/connectivity.',
    shape: service,
    handler: getServiceStatusAction
  },
  {
    name: 'stackarr_list_service_configs',
    description: 'List service config cards/fields.',
    shape: empty,
    handler: listServiceConfigsAction
  },
  {
    name: 'stackarr_get_service_config',
    description: 'Get editable config for one service.',
    shape: service,
    handler: getServiceConfigAction
  },
  {
    name: 'stackarr_get_app_capabilities',
    description: 'List enabled native apps and their named, allowlisted operations.',
    shape: empty,
    handler: getNativeAppCapabilitiesAction
  },
  {
    name: 'stackarr_read_app',
    description: 'Read an enabled app through a named native API operation. Arbitrary paths are not accepted.',
    shape: nativeAppOperation,
    handler: readNativeAppAction
  },
  {
    name: 'stackarr_manage_app',
    description: 'Run a safe named management operation in an enabled app. Arbitrary paths are not accepted.',
    shape: nativeAppOperation,
    handler: manageNativeAppAction
  },
  {
    name: 'stackarr_administer_app',
    description:
      'Run a destructive or file-changing named native-app operation. The control plane asks the user for approval first.',
    shape: { ...nativeAppOperation, reason: z.string().max(500).optional() },
    handler: administerNativeAppAction
  },
  {
    name: 'stackarr_get_routines',
    description: 'List typed agent routines and their daily or weekly schedules.',
    shape: empty,
    handler: getRoutinesAction
  },
  {
    name: 'stackarr_save_routine',
    description: 'Create or update a routine made only from named native-app operations.',
    shape: {
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(80),
      enabled: z.boolean().optional(),
      steps: z.array(routineStep).min(1).max(10),
      schedule: z
        .object({
          frequency: z.enum(['daily', 'weekly']),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          weekday: z.number().int().min(0).max(6).optional()
        })
        .optional()
    },
    handler: saveRoutineAction
  },
  {
    name: 'stackarr_delete_routine',
    description: 'Delete a saved agent routine.',
    shape: { id: z.string().uuid() },
    handler: deleteRoutineAction
  },
  {
    name: 'stackarr_run_routine',
    description: 'Run a saved typed routine now and record the result.',
    shape: { id: z.string().uuid() },
    handler: runRoutineAction
  },
  {
    name: 'stackarr_get_connection_policies',
    description: 'List named remote MCP policies without returning token hashes.',
    shape: empty,
    handler: listMcpConnectionPoliciesAction
  },
  {
    name: 'stackarr_create_connection_policy',
    description: 'Create a revocable MCP connection token. The token is returned once after user approval.',
    shape: {
      name: z.string().min(1).max(80),
      profile: z.enum(['observe', 'manage', 'admin', 'unrestricted']),
      groups: z
        .array(
          z.enum([
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
          ])
        )
        .optional()
    },
    handler: (input) =>
      createMcpConnectionPolicyAction({
        name: input.name,
        profile: input.profile,
        groups: input.groups,
        callerProfile: input.__stackarrCallerProfile
      })
  },
  {
    name: 'stackarr_update_connection_policy',
    description: 'Rename, enable, disable, or narrow a remote MCP policy after user approval.',
    shape: {
      id: z.string().uuid(),
      name: z.string().min(1).max(80).optional(),
      profile: z.enum(['observe', 'manage', 'admin', 'unrestricted']).optional(),
      groups: z
        .array(
          z.enum([
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
          ])
        )
        .optional(),
      enabled: z.boolean().optional()
    },
    handler: (input) => updateMcpConnectionPolicyAction({ ...input, callerProfile: input.__stackarrCallerProfile })
  },
  {
    name: 'stackarr_rotate_connection_token',
    description: 'Revoke a remote MCP token and issue a one-time replacement after user approval.',
    shape: { id: z.string().uuid() },
    handler: (input) =>
      rotateMcpConnectionPolicyTokenAction({ id: input.id, callerProfile: input.__stackarrCallerProfile })
  },
  {
    name: 'stackarr_update_service_config',
    description: 'Update service config values using UI field ids.',
    shape: { service: z.string(), values: z.record(z.string(), z.unknown()) },
    handler: updateServiceConfigAction
  },
  {
    name: 'stackarr_get_container_overview',
    description: 'List Docker containers, volumes, images, and networks.',
    shape: empty,
    handler: getDockerOverviewAction
  },
  {
    name: 'stackarr_manage_container_resource',
    description: 'Manage Docker resources after interactive approval in the MCP client.',
    shape: {
      kind: z.enum(['container', 'volume', 'image', 'network']),
      action: z.enum(['start', 'stop', 'restart', 'remove', 'pruneExited', 'pruneDangling', 'pruneUnused']),
      id: z.string().optional(),
      force: z.boolean().optional(),
      deleteVolumes: z.boolean().optional(),
      ...dangerous
    },
    handler: manageDockerResourceAction
  },
  {
    name: 'stackarr_get_disk_usage',
    description: 'Get disk usage for configured roots.',
    shape: empty,
    handler: getDiskUsageAction
  },
  {
    name: 'stackarr_get_stack_config_summary',
    description: 'Get redacted stack config.',
    shape: empty,
    handler: getStackConfigSummaryAction
  },
  {
    name: 'stackarr_update_stack_config',
    description: 'Update DB-backed Stackarr runtime config by env key.',
    shape: { values: z.record(z.string(), z.unknown()) },
    handler: updateStackConfigAction
  },
  {
    name: 'stackarr_get_telemetry_status',
    description: 'Read opt-in telemetry status and a sanitized payload preview.',
    shape: empty,
    handler: getTelemetryStatusAction
  },
  {
    name: 'stackarr_update_telemetry_config',
    description: 'Enable, disable, or configure first-party telemetry after interactive approval.',
    shape: {
      enabled: z.boolean().optional(),
      endpoint: z.string().optional(),
      channel: z.string().optional()
    },
    handler: updateTelemetryConfigAction
  },
  {
    name: 'stackarr_preview_telemetry_payload',
    description: 'Preview the exact sanitized telemetry heartbeat payload without sending it.',
    shape: empty,
    handler: previewTelemetryPayloadAction
  },
  {
    name: 'stackarr_send_telemetry',
    description: 'Send the sanitized telemetry heartbeat. Defaults to dryRun and requires telemetry to be enabled.',
    shape: {
      dryRun: z.boolean().optional(),
      force: z.boolean().optional()
    },
    handler: sendTelemetryAction
  },
  {
    name: 'stackarr_get_cloudflare_access',
    description: 'Get Cloudflare Access allowlist settings and required token permissions.',
    shape: empty,
    handler: getCloudflareAccessAction
  },
  {
    name: 'stackarr_update_cloudflare_access',
    description:
      'Update Cloudflare Access protection defaults. Route-level access is controlled by stackarr_update_cloudflare_routes.',
    shape: {
      enabled: z.boolean().optional(),
      allowedEmails: z.union([z.array(z.string().email()), z.string()]).optional(),
      sessionDuration: z.string().optional()
    },
    handler: updateCloudflareAccessAction
  },
  {
    name: 'stackarr_get_cloudflare_routes',
    description: 'Get configured Cloudflare tunnel routes.',
    shape: empty,
    handler: getCloudflareRoutesAction
  },
  {
    name: 'stackarr_update_cloudflare_routes',
    description:
      'Update Cloudflare tunnel routes. Each route maps a public hostname to a Stackarr service and can opt in or out of Cloudflare Access.',
    shape: {
      routes: z.array(
        z.object({
          hostname: z.string(),
          service: z.enum([
            'stackarr',
            'pulsarr',
            'maintainerr',
            'tracearr',
            'bookorbit',
            'immich',
            'romm',
            'seerr',
            'transmission',
            'qbittorrent',
            'plex',
            'jellyfin',
            'tinymm',
            'radarr',
            'sonarr',
            'lidarr',
            'prowlarr',
            'bazarr'
          ]),
          access: z.boolean().optional()
        })
      )
    },
    handler: updateCloudflareRoutesAction
  },
  {
    name: 'stackarr_get_recent_activity',
    description: 'Get recent agent activity.',
    shape: { limit: z.number().optional() },
    handler: (i) => listAgentActivityRecords(i.limit)
  },
  {
    name: 'stackarr_get_tasks',
    description: 'Get queued/running/recent Stackarr command tasks with progress output.',
    shape: { activeOnly: z.boolean().optional(), limit: z.number().int().positive().optional() },
    handler: (i) => {
      const tasks = i.activeOnly
        ? readTasks().filter((task) => task.status === 'queued' || task.status === 'running')
        : readTasks();
      return typeof i.limit === 'number' ? tasks.slice(0, i.limit) : tasks;
    }
  },
  {
    name: 'stackarr_start_stack',
    description: 'Start Stackarr stack; dangerous.',
    shape: dangerous,
    handler: startStackAction
  },
  {
    name: 'stackarr_stop_stack',
    description: 'Stop Stackarr stack; dangerous.',
    shape: dangerous,
    handler: stopStackAction
  },
  {
    name: 'stackarr_restart_service',
    description: 'Restart service placeholder.',
    shape: { service: z.string(), ...dangerous },
    handler: (i) => ({
      accepted: false,
      service: i.service,
      note: 'Restart not exposed in V1 command wrapper to avoid accidental downtime.'
    })
  },
  {
    name: 'stackarr_run_update',
    description: 'Run Stackarr update; dangerous.',
    shape: dangerous,
    handler: runUpdateAction
  },
  { name: 'stackarr_run_doctor', description: 'Run doctor diagnostics.', shape: empty, handler: runDoctorAction },
  {
    name: 'stackarr_run_permissions_audit',
    description: 'Run permissions audit.',
    shape: empty,
    handler: runPermissionsAuditAction
  },
  {
    name: 'stackarr_run_permissions_fix',
    description: 'Run permissions fix; dangerous.',
    shape: dangerous,
    handler: runPermissionsFixAction
  },
  {
    name: 'stackarr_search_series',
    description: 'Search Sonarr series.',
    shape: { instance: seriesInstance, term: z.string() },
    handler: searchSeriesAction
  },
  {
    name: 'stackarr_add_series',
    description: 'Add Sonarr series.',
    shape: { instance: seriesInstance, series: z.unknown() },
    handler: addSeriesAction
  },
  {
    name: 'stackarr_monitor_series',
    description: 'Monitor Sonarr series.',
    shape: { instance: seriesInstance, seriesId: z.number(), monitored: z.boolean().default(true) },
    handler: monitorSeriesAction
  },
  {
    name: 'stackarr_unmonitor_series',
    description: 'Unmonitor Sonarr series.',
    shape: { instance: seriesInstance, seriesId: z.number() },
    handler: unmonitorSeriesAction
  },
  {
    name: 'stackarr_search_movie',
    description: 'Search Radarr movie.',
    shape: { instance: movieInstance, term: z.string() },
    handler: searchMovieAction
  },
  {
    name: 'stackarr_add_movie',
    description: 'Add Radarr movie.',
    shape: { instance: movieInstance, movie: z.unknown() },
    handler: addMovieAction
  },
  {
    name: 'stackarr_monitor_movie',
    description: 'Monitor Radarr movie.',
    shape: { instance: movieInstance, movieId: z.number(), monitored: z.boolean().default(true) },
    handler: monitorMovieAction
  },
  {
    name: 'stackarr_unmonitor_movie',
    description: 'Unmonitor Radarr movie.',
    shape: { instance: movieInstance, movieId: z.number() },
    handler: unmonitorMovieAction
  },
  {
    name: 'stackarr_get_series_status',
    description: 'Get series status.',
    shape: { instance: seriesInstance, seriesId: z.number().optional() },
    handler: getSeriesStatusAction
  },
  {
    name: 'stackarr_get_movie_status',
    description: 'Get movie status.',
    shape: { instance: movieInstance, movieId: z.number().optional() },
    handler: getMovieStatusAction
  },
  {
    name: 'stackarr_get_missing_episodes',
    description: 'Get missing episodes.',
    shape: { instance: seriesInstance, page: z.number().optional(), pageSize: z.number().optional() },
    handler: getMissingEpisodesAction
  },
  {
    name: 'stackarr_get_wanted_movies',
    description: 'Get wanted movies.',
    shape: { instance: movieInstance, page: z.number().optional(), pageSize: z.number().optional() },
    handler: getWantedMoviesAction
  },
  {
    name: 'stackarr_get_arr_queue',
    description: 'Get Arr queue.',
    shape: { instance: arrInstance, page: z.number().optional(), pageSize: z.number().optional() },
    handler: getArrQueueAction
  },
  {
    name: 'stackarr_trigger_arr_search',
    description: 'Trigger Arr search.',
    shape: {
      instance: arrInstance,
      command: z.enum([
        'SeriesSearch',
        'EpisodeSearch',
        'MissingEpisodeSearch',
        'MoviesSearch',
        'RefreshSeries',
        'RefreshMovie'
      ]),
      ids: z.array(z.number()).optional()
    },
    handler: triggerArrSearchAction
  },
  {
    name: 'stackarr_refresh_arr_item',
    description: 'Refresh Arr item.',
    shape: { instance: arrInstance, id: z.number() },
    handler: refreshArrItemAction
  },
  {
    name: 'stackarr_search_releases',
    description: 'Search releases.',
    shape: {
      query: z.string(),
      categories: z.array(z.number()).optional(),
      indexerIds: z.array(z.number()).optional()
    },
    handler: searchReleasesAction
  },
  { name: 'stackarr_get_indexer_status', description: 'Get indexers.', shape: empty, handler: getIndexerStatusAction },
  { name: 'stackarr_test_indexers', description: 'Test indexers.', shape: empty, handler: testIndexersAction },
  {
    name: 'stackarr_add_release_to_downloader',
    description: 'Add release to downloader.',
    shape: {
      guid: z.string().optional(),
      indexerId: z.number().optional(),
      downloadUrl: z.string().optional(),
      protocol: z.string().optional()
    },
    handler: addReleaseToDownloaderAction
  },
  {
    name: 'stackarr_get_download_queue',
    description: 'Get download queue.',
    shape: downloader,
    handler: getDownloadQueueAction
  },
  {
    name: 'stackarr_get_download_history',
    description: 'Get download history.',
    shape: downloader,
    handler: getDownloadHistoryAction
  },
  {
    name: 'stackarr_get_stalled_downloads',
    description: 'Get stalled downloads.',
    shape: downloader,
    handler: getStalledDownloadsAction
  },
  {
    name: 'stackarr_add_magnet',
    description: 'Add magnet.',
    shape: { ...downloader, magnet: z.string() },
    handler: addMagnetAction
  },
  {
    name: 'stackarr_add_torrent_url',
    description: 'Add torrent URL.',
    shape: { ...downloader, url: z.string().url() },
    handler: addTorrentUrlAction
  },
  {
    name: 'stackarr_pause_download',
    description: 'Pause download.',
    shape: { ...downloader, id: z.string() },
    handler: pauseDownloadAction
  },
  {
    name: 'stackarr_resume_download',
    description: 'Resume download.',
    shape: { ...downloader, id: z.string() },
    handler: resumeDownloadAction
  },
  {
    name: 'stackarr_remove_download',
    description: 'Remove download.',
    shape: {
      ...downloader,
      id: z.string(),
      deleteData: z.boolean().optional()
    },
    handler: removeDownloadAction
  },
  {
    name: 'stackarr_set_download_priority',
    description: 'Set download priority.',
    shape: { ...downloader, id: z.string(), priority: z.number() },
    handler: setDownloadPriorityAction
  },
  {
    name: 'stackarr_get_streamrip_config',
    description: 'Get redacted Streamrip config.',
    shape: empty,
    handler: getStreamripConfigAction
  },
  {
    name: 'stackarr_update_streamrip_config',
    description: 'Update Streamrip config using UI field ids such as deezer.arl and qobuz.quality.',
    shape: { values: z.record(z.string(), z.unknown()) },
    handler: updateStreamripConfigAction
  },
  {
    name: 'stackarr_test_streamrip',
    description: 'Check whether the Streamrip rip CLI is available.',
    shape: empty,
    handler: testStreamripAction
  },
  {
    name: 'stackarr_start_streamrip_download',
    description: 'Start a Streamrip URL download as a Stackarr-managed job.',
    shape: { url: z.string().url() },
    handler: startStreamripDownloadAction
  },
  {
    name: 'stackarr_start_streamrip_search_download',
    description: 'Search a Streamrip source and automatically download the first matching result.',
    shape: {
      source: z.enum(['qobuz', 'tidal', 'deezer', 'soundcloud']),
      mediaType: z.enum(['album', 'track', 'playlist', 'artist']).optional(),
      query: z.string()
    },
    handler: startStreamripSearchDownloadAction
  },
  {
    name: 'stackarr_list_streamrip_jobs',
    description: 'List recent Stackarr-managed Streamrip jobs.',
    shape: empty,
    handler: listStreamripJobsAction
  },
  {
    name: 'stackarr_cancel_streamrip_job',
    description: 'Cancel a running Streamrip job.',
    shape: { id: z.string() },
    handler: cancelStreamripJobAction
  },
  {
    name: 'stackarr_list_lidarr_streamrip_albums',
    description: 'List Lidarr albums prepared for Streamrip downloading.',
    shape: {
      query: z.string().optional(),
      missingOnly: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional()
    },
    handler: listLidarrStreamripAlbumsAction
  },
  {
    name: 'stackarr_prepare_lidarr_streamrip_album',
    description: 'Read Lidarr album/artist metadata and produce a Streamrip search query.',
    shape: { albumId: z.number() },
    handler: prepareLidarrStreamripAlbumAction
  },
  {
    name: 'stackarr_download_lidarr_album_with_streamrip',
    description: 'Download a Lidarr album with Streamrip using either an explicit URL or Streamrip source search.',
    shape: {
      albumId: z.number(),
      url: z.string().url().optional(),
      source: z.enum(['qobuz', 'tidal', 'deezer', 'soundcloud']).optional()
    },
    handler: downloadLidarrAlbumWithStreamripAction
  },
  {
    name: 'stackarr_get_plex_server_status',
    description: 'Get Plex status.',
    shape: empty,
    handler: getPlexServerStatusAction
  },
  {
    name: 'stackarr_get_plex_libraries',
    description: 'Get Plex libraries.',
    shape: empty,
    handler: getPlexLibrariesAction
  },
  {
    name: 'stackarr_get_plex_sessions',
    description: 'Get Plex sessions.',
    shape: empty,
    handler: getPlexSessionsAction
  },
  {
    name: 'stackarr_get_recently_added',
    description: 'Get recently added Plex items.',
    shape: { limit: z.number().optional() },
    handler: getRecentlyAddedAction
  },
  {
    name: 'stackarr_get_recently_watched',
    description: 'Get recently watched Plex items.',
    shape: { limit: z.number().optional() },
    handler: getRecentlyWatchedAction
  },
  {
    name: 'stackarr_get_plex_watch_summary',
    description: 'Get Plex watch summary.',
    shape: { provider: z.enum(['plex', 'tracearr']).optional() },
    handler: getPlexWatchSummaryAction
  },
  {
    name: 'stackarr_scan_plex_library',
    description: 'Scan Plex library.',
    shape: { sectionId: z.union([z.string(), z.number()]) },
    handler: scanPlexLibraryAction
  },
  {
    name: 'stackarr_refresh_plex_metadata',
    description: 'Refresh Plex metadata.',
    shape: { ratingKey: z.union([z.string(), z.number()]) },
    handler: refreshPlexMetadataAction
  },
  {
    name: 'stackarr_get_requests',
    description: 'Get Seerr requests.',
    shape: { take: z.number().optional(), skip: z.number().optional(), filter: z.string().optional() },
    handler: getRequestsAction
  },
  {
    name: 'stackarr_create_request',
    description: 'Create Seerr request.',
    shape: {
      mediaType: z.enum(['movie', 'tv']),
      mediaId: z.number(),
      is4k: z.boolean().optional(),
      seasons: z.array(z.number()).optional()
    },
    handler: createRequestAction
  },
  {
    name: 'stackarr_approve_request',
    description: 'Approve request.',
    shape: { requestId: z.number() },
    handler: approveRequestAction
  },
  {
    name: 'stackarr_decline_request',
    description: 'Decline request.',
    shape: { requestId: z.number(), reason: z.string().optional() },
    handler: declineRequestAction
  },
  {
    name: 'stackarr_get_request_status',
    description: 'Get request status.',
    shape: { requestId: z.number() },
    handler: getRequestStatusAction
  },
  { name: 'stackarr_run_backup', description: 'Run backup.', shape: empty, handler: runBackupWorkflowAction },
  { name: 'stackarr_list_backups', description: 'List backups.', shape: empty, handler: listBackupsAction },
  {
    name: 'stackarr_validate_backup',
    description: 'Validate backup.',
    shape: { backupPath: z.string() },
    handler: validateBackupAction
  },
  {
    name: 'stackarr_get_backup_status',
    description: 'Get backup status.',
    shape: empty,
    handler: getBackupStatusAction
  },
  {
    name: 'stackarr_restore_backup',
    description: 'Restore backup; dangerous.',
    shape: {
      backupPath: z.string(),
      dryRun: z.boolean().optional(),
      forceConfig: z.boolean().optional(),
      restorePostgres: z.boolean().optional(),
      restoreNativePlex: z.boolean().optional(),
      restorePlexPreferences: z.boolean().optional(),
      markOnboardingComplete: z.boolean().optional(),
      ...dangerous
    },
    handler: restoreBackupAction
  },
  {
    name: 'stackarr_migrate_current_stack',
    description:
      'Plan or run migration from an existing local media stack into Stackarr; dangerous when dryRun is false.',
    shape: {
      dryRun: z.boolean().optional(),
      sourceRoot: z.string().optional(),
      stopSourceContainers: z.boolean().optional(),
      overwrite: z.boolean().optional(),
      ...dangerous
    },
    handler: migrateCurrentStackAction
  },
  {
    name: 'stackarr_check_service_databases',
    description: 'Check DBs.',
    shape: empty,
    handler: checkServiceDatabasesAction
  },
  {
    name: 'stackarr_validate_sqlite_db',
    description: 'Validate SQLite DB.',
    shape: { path: z.string() },
    handler: validateSqliteDbAction
  },
  {
    name: 'stackarr_restore_service_database_from_backup',
    description: 'Restore service DB; dangerous.',
    shape: { service: z.string(), backupPath: z.string(), ...dangerous },
    handler: restoreServiceDatabaseFromBackupAction
  },
  {
    name: 'stackarr_diagnose_service',
    description: 'Diagnose service.',
    shape: service,
    handler: diagnoseServiceAction
  },
  {
    name: 'stackarr_test_service_api',
    description: 'Test service API.',
    shape: service,
    handler: testServiceApiAction
  },
  {
    name: 'stackarr_test_service_connectivity',
    description: 'Test service connectivity.',
    shape: service,
    handler: testServiceConnectivityAction
  },
  {
    name: 'stackarr_test_arr_to_downloader',
    description: 'Test Arr to downloader.',
    shape: empty,
    handler: testArrToDownloaderAction
  },
  {
    name: 'stackarr_test_prowlarr_to_arr',
    description: 'Test Prowlarr to Arr.',
    shape: empty,
    handler: testProwlarrToArrAction
  },
  {
    name: 'stackarr_test_seerr_to_arr',
    description: 'Test Seerr to Arr.',
    shape: empty,
    handler: testSeerrToArrAction
  },
  {
    name: 'stackarr_test_plex_identity',
    description: 'Test Plex identity.',
    shape: empty,
    handler: testPlexIdentityAction
  },
  {
    name: 'stackarr_get_common_issues',
    description: 'Get common issues.',
    shape: empty,
    handler: getCommonIssuesAction
  },
  {
    name: 'stackarr_apply_safe_fix',
    description: 'Apply enumerated safe fix.',
    shape: { fixId: z.enum(['refresh-status-cache', 'none']) },
    handler: applySafeFixAction
  }
];

export function registerStackarrTools(
  server: McpServer,
  profile: McpProfile = resolveMcpProfile(),
  options: { groups?: ToolCategory[]; caller?: `mcp-remote:${string}` | 'mcp-local' } = {}
) {
  const enabledServices = getEnabledMcpServiceNames();
  const enabledCatalog = getMcpToolCatalog({ profile, enabledServices, groups: options.groups });
  const enabledTools = new Map(enabledCatalog.map((entry) => [entry.name, entry]));

  for (const tool of tools) {
    const meta = enabledTools.get(tool.name);
    if (!meta) continue;

    server.registerTool(
      tool.name,
      {
        title: toolTitle(tool.name),
        description: tool.description,
        inputSchema: tool.shape,
        annotations: toolAnnotations(meta),
        _meta: {
          'stackarr/category': meta.category,
          'stackarr/risk': meta.risk,
          'stackarr/profile': profile
        }
      },
      async (input) => {
        const started = Date.now();
        const activity = await auditStarted({
          caller: options.caller ?? 'mcp-local',
          toolName: tool.name,
          category: meta.category,
          scopes: meta.scopes,
          risk: meta.risk,
          inputSummary: input
        });
        try {
          const authorization = await authorizeToolCall(server, profile, meta, input);
          if (!authorization.approved) {
            await auditFinished(activity.id, {
              status: 'denied',
              durationMs: Date.now() - started,
              resultSummary: summarize(authorization.result),
              error: denialReason(authorization.result)
            });
            return jsonContent(authorization.result);
          }

          const result = await tool.handler({
            ...authorization.input,
            __stackarrCallerProfile: profile,
            __stackarrGroups: options.groups
          });
          await auditFinished(activity.id, {
            status: 'success',
            durationMs: Date.now() - started,
            resultSummary: summarize(result)
          });
          return jsonContent(result);
        } catch (error) {
          const status = error instanceof DangerousActionError ? 'denied' : 'error';
          await auditFinished(activity.id, {
            status,
            durationMs: Date.now() - started,
            error: serializeError(error).message
          });
          throw error;
        }
      }
    );
  }
}

async function authorizeToolCall(
  server: McpServer,
  profile: McpProfile,
  meta: ToolCatalogEntry,
  input: Record<string, unknown>
): Promise<{ approved: true; input: Record<string, unknown> } | { approved: false; result: Record<string, unknown> }> {
  const blockedCredentialKeys = credentialKeysInConfigurationCall(meta.name, input);
  if (blockedCredentialKeys.length > 0) {
    return {
      approved: false,
      result: {
        accepted: false,
        tool: meta.name,
        blockedCredentialKeys,
        error: 'Credentials and account identities must be changed through an authenticated settings surface, not MCP.'
      }
    };
  }

  if (!requiresInteractiveApproval(meta, input)) {
    return { approved: true, input };
  }

  if (profile === 'unrestricted') {
    return { approved: true, input: withInternalApproval(input) };
  }

  if (!server.server.getClientCapabilities()?.elicitation) {
    return {
      approved: false,
      result: {
        accepted: false,
        approvalRequired: true,
        tool: meta.name,
        error: 'This MCP client does not declare support for interactive elicitation.',
        nextStep:
          'Use a client with MCP form elicitation support, or deliberately launch Stackarr with STACKARR_MCP_PROFILE=unrestricted.'
      }
    };
  }

  const result = await server.server.elicitInput({
    mode: 'form',
    _meta: { codex_approval_kind: 'mcp_tool_call' },
    message: approvalMessage(meta, input),
    requestedSchema: {
      type: 'object',
      properties: {
        approve: {
          type: 'boolean',
          title: 'Approve this action',
          description: 'Enable only after reviewing the exact action and arguments above.',
          default: false
        }
      },
      required: ['approve']
    }
  });

  if (result.action !== 'accept' || result.content?.approve !== true) {
    return {
      approved: false,
      result: {
        accepted: false,
        approvalRequired: true,
        tool: meta.name,
        decision: result.action,
        message: 'The action was not approved by the user.'
      }
    };
  }

  return { approved: true, input: withInternalApproval(input) };
}

function credentialKeysInConfigurationCall(toolName: string, input: Record<string, unknown>) {
  if (
    toolName !== 'stackarr_update_service_config' &&
    toolName !== 'stackarr_update_stack_config' &&
    toolName !== 'stackarr_update_streamrip_config'
  ) {
    return [];
  }

  const values = input.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];

  return Object.keys(values).filter((key) =>
    /(password|passwd|token|secret|credential|username|email|claim|api[_-]?key|apikey|(^|[._-])arl$|app[_-]?id|client[_-]?id)/i.test(
      key
    )
  );
}

function requiresInteractiveApproval(meta: ToolCatalogEntry, input: Record<string, unknown>) {
  if (meta.risk !== 'dangerous') return false;

  if (meta.name === 'stackarr_setup_media_server') return input.dryRun === false;
  if (meta.name === 'stackarr_restore_backup' || meta.name === 'stackarr_migrate_current_stack') {
    return input.dryRun === false;
  }

  return true;
}

function withInternalApproval(input: Record<string, unknown>) {
  return {
    ...input,
    confirmDangerous: true,
    confirmSetup: true,
    confirmTelemetry: true,
    confirmDeleteData: true,
    trustedControlPlaneApproval: true,
    reason:
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason
        : 'Approved interactively through the Stackarr MCP control plane.'
  };
}

function approvalMessage(meta: ToolCatalogEntry, input: Record<string, unknown>) {
  const summary = JSON.stringify(redactSecrets(input), null, 2);
  const boundedSummary = summary.length > 3000 ? `${summary.slice(0, 3000)}\n…` : summary;
  return `Stackarr wants to run a destructive action.\n\nTool: ${meta.name}\nCategory: ${meta.category}\n\nArguments:\n${boundedSummary}`;
}

function toolAnnotations(meta: ToolCatalogEntry) {
  return {
    title: toolTitle(meta.name),
    readOnlyHint: meta.risk === 'read',
    destructiveHint: meta.risk === 'dangerous',
    idempotentHint: meta.risk === 'read',
    openWorldHint: ['services', 'apps', 'arr', 'releases', 'downloads', 'plex', 'seerr'].includes(meta.category)
  };
}

function toolTitle(name: string) {
  return name
    .replace(/^stackarr_/, '')
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function getRegisteredControlPlaneSummary(
  profile: McpProfile = resolveMcpProfile(),
  options: { groups?: ToolCategory[] } = {}
) {
  const selection = getMcpServiceSelection();
  const enabledServices = selection.enabledServices;
  const catalog = getMcpToolCatalog({ profile, enabledServices, groups: options.groups });
  return {
    profile,
    description: getMcpProfileDescription(profile),
    approvalMode: profile === 'unrestricted' ? 'unrestricted' : 'client-elicitation',
    selectedGroups: options.groups ?? resolveMcpGroups() ?? 'all-relevant',
    catalogMode: selection.catalogMode,
    onboardingComplete: selection.onboardingComplete,
    nextStep: selection.onboardingComplete
      ? 'Ask Stackarr to inspect, manage, or troubleshoot the configured services.'
      : 'Complete setup from chat or the dashboard; reconnect MCP afterward to load tools for the selected apps.',
    enabledServices,
    toolCount: catalog.length,
    groups: Object.fromEntries(
      [...new Set(catalog.map((tool) => tool.category))].map((category) => [
        category,
        catalog.filter((tool) => tool.category === category).map((tool) => tool.name)
      ])
    )
  };
}

function normalizeMcpMediaServerMode(value: 'disabled' | 'existing' | 'docker' | undefined) {
  return value === 'existing' ? ('native' as const) : value;
}

function summarize(result: unknown) {
  if (Array.isArray(result)) return { type: 'array', count: result.length };
  if (result && typeof result === 'object') return { type: 'object', keys: Object.keys(result).slice(0, 12) };
  return result;
}

function denialReason(result: Record<string, unknown>) {
  if (typeof result.error === 'string') return result.error;
  if (typeof result.message === 'string') return result.message;
  return 'The MCP action was not approved.';
}
