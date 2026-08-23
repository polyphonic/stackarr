import type { ToolCatalogEntry } from './types';

export const stackarrToolCatalog: ToolCatalogEntry[] = [
  {
    name: 'stackarr_get_setup_profile',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return the opinionated Stackarr setup questions, defaults, and browser port.'
  },
  {
    name: 'stackarr_get_mcp_control_plane',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return the active MCP authority profile, approval mode, service groups, and exposed tools.'
  },
  {
    name: 'stackarr_get_mcp_connection_kit',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Generate safe connection commands and configuration for a supported chat or MCP client.'
  },
  {
    name: 'stackarr_setup_media_server',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description:
      'Write Stackarr setup config and optionally run the full download/start/configure media-server workflow.'
  },
  {
    name: 'stackarr_get_system_status',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Summarize Stackarr system status.'
  },
  {
    name: 'stackarr_list_services',
    category: 'services',
    scopes: ['services:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List configured Stackarr services.'
  },
  {
    name: 'stackarr_get_service_status',
    category: 'services',
    scopes: ['services:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get static/service connectivity status for one service.'
  },
  {
    name: 'stackarr_list_service_configs',
    category: 'services',
    scopes: ['services:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List configurable service cards and fields exposed by Stackarr.'
  },
  {
    name: 'stackarr_get_service_config',
    category: 'services',
    scopes: ['services:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read UI-editable Stackarr configuration for one service.'
  },
  {
    name: 'stackarr_get_romm_metadata_providers',
    category: 'services',
    scopes: ['services:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List RomM metadata providers and report their secret-safe configured/enabled state.'
  },
  {
    name: 'stackarr_get_app_capabilities',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List enabled native apps and their allowlisted read/manage operations.'
  },
  {
    name: 'stackarr_read_app',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read an enabled app through a named, allowlisted native API operation.'
  },
  {
    name: 'stackarr_manage_app',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run a safe named management operation through an enabled app native API.'
  },
  {
    name: 'stackarr_administer_app',
    category: 'apps',
    scopes: ['apps:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run an explicitly destructive or file-changing named native-app operation after user approval.'
  },
  {
    name: 'stackarr_list_pulsarr_users',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List Pulsarr users with watchlist counts and configured quotas through its native API.'
  },
  {
    name: 'stackarr_get_pulsarr_user_diagnostics',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read one Pulsarr user profile, watchlist, quota configuration, and held-request count.'
  },
  {
    name: 'stackarr_set_pulsarr_user_sync',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Enable or disable Pulsarr watchlist synchronization for one user through its native API.'
  },
  {
    name: 'stackarr_set_pulsarr_user_quotas',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Create, update, or disable separate Pulsarr movie/show quotas through its native API.'
  },
  {
    name: 'stackarr_get_agregarr_overview',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Summarize Agregarr collections, hubs, sync health, and schedules.'
  },
  {
    name: 'stackarr_get_agregarr_collection',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read one managed Agregarr collection and its sync status.'
  },
  {
    name: 'stackarr_get_agregarr_home_order',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read fixed and randomized Agregarr-managed Plex home rows.'
  },
  {
    name: 'stackarr_sync_agregarr_collection',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Start a targeted sync for one managed Agregarr collection.'
  },
  {
    name: 'stackarr_sync_agregarr_collection_group',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Start targeted syncs for linked Agregarr movie and TV collections.'
  },
  {
    name: 'stackarr_update_agregarr_collection_group',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Update visibility, active state, and ordering for linked Agregarr collections.'
  },
  {
    name: 'stackarr_ensure_agregarr_collection_preset',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Create or normalize a common Agregarr collection source across selected Plex libraries.'
  },
  {
    name: 'stackarr_run_agregarr_job',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run an allowlisted Agregarr sync or home-order randomization job.'
  },
  {
    name: 'stackarr_search_questarr_games',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Search IGDB through Questarr and return a bounded game summary.'
  },
  {
    name: 'stackarr_search_questarr_releases',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Search Questarr indexers and return bounded release metadata without exposing download URLs.'
  },
  {
    name: 'stackarr_get_questarr_downloads',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List a bounded summary of downloads visible to Questarr.'
  },
  {
    name: 'stackarr_start_questarr_download',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Start one exact Questarr search result through its configured downloader.'
  },
  {
    name: 'stackarr_get_youtarr_health',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read Youtarr application and MariaDB health without exposing credentials.'
  },
  {
    name: 'stackarr_get_youtarr_videos',
    category: 'apps',
    scopes: ['apps:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List a bounded summary of videos in the Youtarr library.'
  },
  {
    name: 'stackarr_queue_youtarr_download',
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Queue one exact YouTube video URL in Youtarr.'
  },
  {
    name: 'stackarr_get_routines',
    category: 'automations',
    scopes: ['automations:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List typed multi-step agent routines and their safe daily or weekly schedules.'
  },
  {
    name: 'stackarr_save_routine',
    category: 'automations',
    scopes: ['automations:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Create or update a routine made only from allowlisted native-app operations.'
  },
  {
    name: 'stackarr_delete_routine',
    category: 'automations',
    scopes: ['automations:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Delete a named agent routine.'
  },
  {
    name: 'stackarr_run_routine',
    category: 'automations',
    scopes: ['automations:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run a saved typed routine now and record its result in Agent Activity.'
  },
  {
    name: 'stackarr_get_connection_policies',
    category: 'connections',
    scopes: ['connections:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'List named MCP connection policies without returning their token hashes.'
  },
  {
    name: 'stackarr_create_connection_policy',
    category: 'connections',
    scopes: ['connections:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Create a revocable MCP bearer token with bounded profile and tool groups.'
  },
  {
    name: 'stackarr_update_connection_policy',
    category: 'connections',
    scopes: ['connections:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Rename, disable, or narrow a named MCP connection policy.'
  },
  {
    name: 'stackarr_rotate_connection_token',
    category: 'connections',
    scopes: ['connections:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Revoke a connection token and issue a one-time replacement.'
  },
  {
    name: 'stackarr_update_service_config',
    category: 'services',
    scopes: ['services:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Update one service configuration using the same field ids exposed in the Stackarr UI.'
  },
  {
    name: 'stackarr_get_container_overview',
    category: 'containers',
    scopes: ['containers:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List Docker containers, volumes, images, and networks visible to Stackarr.'
  },
  {
    name: 'stackarr_manage_container_resource',
    category: 'containers',
    scopes: ['containers:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Start, stop, restart, remove, or prune Docker containers, images, and networks.'
  },
  {
    name: 'stackarr_remove_docker_volume',
    category: 'containers',
    scopes: ['containers:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Remove one reviewed Docker volume by exact name; bulk volume pruning is unavailable.'
  },
  {
    name: 'stackarr_get_disk_usage',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read disk usage for configured roots.'
  },
  {
    name: 'stackarr_get_stack_config_summary',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return redacted Stackarr configuration summary.'
  },
  {
    name: 'stackarr_update_stack_config',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Update DB-backed Stackarr runtime configuration values by managed env key.'
  },
  {
    name: 'stackarr_get_telemetry_status',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read opt-in telemetry status and a sanitized heartbeat payload preview.'
  },
  {
    name: 'stackarr_update_telemetry_config',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Enable, disable, or configure first-party telemetry after explicit consent.'
  },
  {
    name: 'stackarr_preview_telemetry_payload',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Preview the exact sanitized telemetry heartbeat payload without sending it.'
  },
  {
    name: 'stackarr_send_telemetry',
    category: 'stack',
    scopes: ['stack:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Send the opt-in telemetry heartbeat to the configured first-party endpoint.'
  },
  {
    name: 'stackarr_get_cloudflare_access',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return Cloudflare Access allowlist settings and the required Cloudflare API token permissions.'
  },
  {
    name: 'stackarr_add_cloudflare_access_email',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Append one Cloudflare Access allowlist email and queue publishing without replacing existing members.'
  },
  {
    name: 'stackarr_update_cloudflare_access',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Update Cloudflare Access allowlist emails, session duration, and default enablement.'
  },
  {
    name: 'stackarr_get_cloudflare_routes',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return configured Cloudflare tunnel public hostname routes.'
  },
  {
    name: 'stackarr_update_cloudflare_routes',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description:
      'Update Cloudflare tunnel hostname routes and per-route Cloudflare Access protection for Stackarr services.'
  },
  {
    name: 'stackarr_get_recent_activity',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return recent agent activity records.'
  },
  {
    name: 'stackarr_get_tasks',
    category: 'stack',
    scopes: ['stack:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return queued, running, and recent Stackarr command tasks with progress output.'
  },
  {
    name: 'stackarr_start_stack',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Start the Docker-managed Stackarr stack.'
  },
  {
    name: 'stackarr_stop_stack',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Stop the Docker-managed Stackarr stack.'
  },
  {
    name: 'stackarr_restart_service',
    category: 'services',
    scopes: ['services:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Restart an individual Docker-managed service.'
  },
  {
    name: 'stackarr_run_update',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run Stackarr update workflow.'
  },
  {
    name: 'stackarr_run_doctor',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Run Stackarr doctor diagnostics.'
  },
  {
    name: 'stackarr_run_permissions_audit',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Run permissions audit.'
  },
  {
    name: 'stackarr_run_permissions_fix',
    category: 'health',
    scopes: ['health:write'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run permissions fix workflow.'
  },
  {
    name: 'stackarr_search_series',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Search Sonarr series by term.'
  },
  {
    name: 'stackarr_add_series',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Add a series to Sonarr.'
  },
  {
    name: 'stackarr_monitor_series',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Monitor a Sonarr series.'
  },
  {
    name: 'stackarr_unmonitor_series',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Unmonitor a Sonarr series.'
  },
  {
    name: 'stackarr_search_movie',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Search Radarr movies by term.'
  },
  {
    name: 'stackarr_add_movie',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Add a movie to Radarr.'
  },
  {
    name: 'stackarr_monitor_movie',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Monitor a Radarr movie.'
  },
  {
    name: 'stackarr_unmonitor_movie',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Unmonitor a Radarr movie.'
  },
  {
    name: 'stackarr_get_series_status',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get a Sonarr series status.'
  },
  {
    name: 'stackarr_get_movie_status',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get a Radarr movie status.'
  },
  {
    name: 'stackarr_get_movie_download_provenance',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get safe Radarr grab and import provenance.'
  },
  {
    name: 'stackarr_get_episode_download_provenance',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get safe Sonarr grab and import provenance.'
  },
  {
    name: 'stackarr_get_missing_episodes',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List missing Sonarr episodes.'
  },
  {
    name: 'stackarr_get_wanted_movies',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List wanted Radarr movies.'
  },
  {
    name: 'stackarr_get_arr_queue',
    category: 'arr',
    scopes: ['arr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get Sonarr/Radarr queue.'
  },
  {
    name: 'stackarr_trigger_arr_search',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Trigger an Arr search command.'
  },
  {
    name: 'stackarr_refresh_arr_item',
    category: 'arr',
    scopes: ['arr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Refresh a series/movie in Arr.'
  },
  {
    name: 'stackarr_search_releases',
    category: 'releases',
    scopes: ['releases:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Search Prowlarr releases.'
  },
  {
    name: 'stackarr_get_indexer_status',
    category: 'releases',
    scopes: ['releases:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get Prowlarr indexer status.'
  },
  {
    name: 'stackarr_test_indexers',
    category: 'releases',
    scopes: ['releases:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test configured Prowlarr indexers.'
  },
  {
    name: 'stackarr_add_release_to_downloader',
    category: 'releases',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Send a Prowlarr release to downloader.'
  },
  {
    name: 'stackarr_get_download_queue',
    category: 'downloads',
    scopes: ['downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get downloader queue.'
  },
  {
    name: 'stackarr_get_download_history',
    category: 'downloads',
    scopes: ['downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get downloader history.'
  },
  {
    name: 'stackarr_get_stalled_downloads',
    category: 'downloads',
    scopes: ['downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List stalled downloads.'
  },
  {
    name: 'stackarr_add_magnet',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Add a magnet link to downloader.'
  },
  {
    name: 'stackarr_add_torrent_url',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Add torrent URL to downloader.'
  },
  {
    name: 'stackarr_pause_download',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Pause a download.'
  },
  {
    name: 'stackarr_resume_download',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Resume a download.'
  },
  {
    name: 'stackarr_remove_download',
    category: 'downloads',
    scopes: ['downloads:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Remove a download, optionally deleting data.'
  },
  {
    name: 'stackarr_set_download_priority',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Set download priority.'
  },
  {
    name: 'stackarr_get_streamrip_config',
    category: 'downloads',
    scopes: ['downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read redacted Streamrip configuration.'
  },
  {
    name: 'stackarr_update_streamrip_config',
    category: 'downloads',
    scopes: ['downloads:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Update Streamrip configuration fields.'
  },
  {
    name: 'stackarr_test_streamrip',
    category: 'downloads',
    scopes: ['downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Check the Streamrip CLI installation.'
  },
  {
    name: 'stackarr_start_streamrip_download',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Start a Streamrip URL download job.'
  },
  {
    name: 'stackarr_start_streamrip_search_download',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Search a Streamrip source and download the first matching result.'
  },
  {
    name: 'stackarr_list_streamrip_jobs',
    category: 'downloads',
    scopes: ['downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List recent Streamrip jobs.'
  },
  {
    name: 'stackarr_cancel_streamrip_job',
    category: 'downloads',
    scopes: ['downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Cancel a running Streamrip job.'
  },
  {
    name: 'stackarr_list_lidarr_streamrip_albums',
    category: 'downloads',
    scopes: ['arr:read', 'downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List Lidarr albums prepared for Streamrip downloading.'
  },
  {
    name: 'stackarr_prepare_lidarr_streamrip_album',
    category: 'downloads',
    scopes: ['arr:read', 'downloads:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Prepare a Lidarr album for Streamrip by returning metadata and a source-search query.'
  },
  {
    name: 'stackarr_download_lidarr_album_with_streamrip',
    category: 'downloads',
    scopes: ['arr:read', 'downloads:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Download a Lidarr album with Streamrip via explicit URL or source search.'
  },
  {
    name: 'stackarr_get_plex_server_status',
    category: 'plex',
    scopes: ['plex:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read Plex server status via Plex API.'
  },
  {
    name: 'stackarr_get_plex_libraries',
    category: 'plex',
    scopes: ['plex:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List Plex libraries.'
  },
  {
    name: 'stackarr_get_plex_sessions',
    category: 'plex',
    scopes: ['plex:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List active Plex sessions.'
  },
  {
    name: 'stackarr_get_recently_added',
    category: 'plex',
    scopes: ['plex:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List recently added Plex items.'
  },
  {
    name: 'stackarr_get_recently_watched',
    category: 'plex',
    scopes: ['plex:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List recently watched Plex items where available.'
  },
  {
    name: 'stackarr_get_plex_watch_summary',
    category: 'plex',
    scopes: ['plex:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Summarize Plex watch activity via Plex API.'
  },
  {
    name: 'stackarr_scan_plex_library',
    category: 'plex',
    scopes: ['plex:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Trigger a Plex library scan.'
  },
  {
    name: 'stackarr_refresh_plex_metadata',
    category: 'plex',
    scopes: ['plex:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Refresh Plex metadata.'
  },
  {
    name: 'stackarr_get_requests',
    category: 'seerr',
    scopes: ['seerr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List Seerr requests.'
  },
  {
    name: 'stackarr_create_request',
    category: 'seerr',
    scopes: ['seerr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Create a Seerr request.'
  },
  {
    name: 'stackarr_approve_request',
    category: 'seerr',
    scopes: ['seerr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Approve a Seerr request.'
  },
  {
    name: 'stackarr_decline_request',
    category: 'seerr',
    scopes: ['seerr:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Decline a Seerr request.'
  },
  {
    name: 'stackarr_get_request_status',
    category: 'seerr',
    scopes: ['seerr:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Get one Seerr request status.'
  },
  {
    name: 'stackarr_run_backup',
    category: 'backups',
    scopes: ['backups:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Run Stackarr backup.'
  },
  {
    name: 'stackarr_list_backups',
    category: 'backups',
    scopes: ['backups:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'List backup artifacts.'
  },
  {
    name: 'stackarr_validate_backup',
    category: 'backups',
    scopes: ['backups:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Validate a backup artifact.'
  },
  {
    name: 'stackarr_get_backup_status',
    category: 'backups',
    scopes: ['backups:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Read backup status.'
  },
  {
    name: 'stackarr_restore_backup',
    category: 'backups',
    scopes: ['backups:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Restore from backup.'
  },
  {
    name: 'stackarr_migrate_current_stack',
    category: 'stack',
    scopes: ['stack:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Plan or run migration from an existing local media stack into Stackarr.'
  },
  {
    name: 'stackarr_check_service_databases',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Check service SQLite databases.'
  },
  {
    name: 'stackarr_validate_sqlite_db',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Validate a SQLite database.'
  },
  {
    name: 'stackarr_restore_service_database_from_backup',
    category: 'backups',
    scopes: ['backups:dangerous'],
    risk: 'dangerous',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Restore service database from backup.'
  },
  {
    name: 'stackarr_diagnose_service',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Diagnose a service.'
  },
  {
    name: 'stackarr_test_service_api',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test a service API.'
  },
  {
    name: 'stackarr_test_service_connectivity',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test service network connectivity.'
  },
  {
    name: 'stackarr_test_arr_to_downloader',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test Arr to downloader configuration.'
  },
  {
    name: 'stackarr_test_prowlarr_to_arr',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test Prowlarr to Arr integration.'
  },
  {
    name: 'stackarr_test_seerr_to_arr',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test Seerr to Arr integration.'
  },
  {
    name: 'stackarr_test_plex_identity',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Test Plex identity.'
  },
  {
    name: 'stackarr_get_common_issues',
    category: 'health',
    scopes: ['health:read'],
    risk: 'read',
    enabledForLocalMcp: true,
    remoteReadyDefault: true,
    description: 'Return common issue hints.'
  },
  {
    name: 'stackarr_apply_safe_fix',
    category: 'health',
    scopes: ['health:write'],
    risk: 'write',
    enabledForLocalMcp: true,
    remoteReadyDefault: false,
    description: 'Apply an enumerated safe fix.'
  }
];

export function getToolCatalog() {
  return stackarrToolCatalog;
}

export function getToolCatalogEntry(name: string) {
  return stackarrToolCatalog.find((entry) => entry.name === name);
}
