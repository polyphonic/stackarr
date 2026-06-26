import type { ScopeGrant } from './scopes';

export type PolicyProfile = 'local-trusted' | 'remote-restricted';

export type StackarrPolicy = {
  profile: PolicyProfile;
  scopes: ScopeGrant[];
  requireDangerousConfirmFlag: boolean;
  remote: boolean;
};

export const localTrustedPolicy: StackarrPolicy = {
  profile: 'local-trusted',
  scopes: ['*'],
  requireDangerousConfirmFlag: true,
  remote: false
};

export const remoteRestrictedPolicy: StackarrPolicy = {
  profile: 'remote-restricted',
  scopes: [
    'stack:read',
    'services:read',
    'containers:read',
    'arr:read',
    'downloads:read',
    'plex:read',
    'backups:read',
    'health:read'
  ],
  requireDangerousConfirmFlag: true,
  remote: true
};
