import type { RiskLevel, StackarrScope } from '../safety/scopes';

export type McpProfile = 'observe' | 'manage' | 'admin' | 'unrestricted';

export type ToolCategory =
  | 'stack'
  | 'services'
  | 'containers'
  | 'arr'
  | 'releases'
  | 'downloads'
  | 'plex'
  | 'seerr'
  | 'backups'
  | 'health';

export type ToolCatalogEntry = {
  name: string;
  category: ToolCategory;
  scopes: StackarrScope[];
  risk: RiskLevel;
  enabledForLocalMcp: boolean;
  remoteReadyDefault: boolean;
  description: string;
};
