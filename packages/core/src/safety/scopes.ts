export type StackarrScope =
  | 'stack:read'
  | 'stack:write'
  | 'stack:dangerous'
  | 'services:read'
  | 'services:write'
  | 'containers:read'
  | 'containers:write'
  | 'containers:dangerous'
  | 'arr:read'
  | 'arr:write'
  | 'arr:dangerous'
  | 'releases:read'
  | 'downloads:read'
  | 'downloads:write'
  | 'downloads:dangerous'
  | 'plex:read'
  | 'plex:write'
  | 'seerr:read'
  | 'seerr:write'
  | 'backups:read'
  | 'backups:write'
  | 'backups:dangerous'
  | 'health:read'
  | 'health:write';

export type RiskLevel = 'read' | 'write' | 'dangerous';
export type ScopeGrant = StackarrScope | '*';

export function hasScope(grants: ScopeGrant[], required: StackarrScope): boolean {
  return grants.includes('*') || grants.includes(required);
}
