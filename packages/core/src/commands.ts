export type CommandName =
  | 'StackStart'
  | 'StackStop'
  | 'StackConfigure'
  | 'RestoreBackup'
  | 'MigrateCurrentStack'
  | 'ApplyNamingPreset'
  | 'ApplyDownloadsPreset'
  | 'SecurityApply'
  | 'ApplyRequestsPreset'
  | 'ClearRequestsPreset'
  | 'Backup'
  | 'BackupPermissions'
  | 'Update'
  | 'PlexCheck'
  | 'PermissionsAudit'
  | 'PermissionsFix'
  | 'StartupInstall'
  | 'StartupUninstall'
  | 'BackupInstall'
  | 'BackupUninstall'
  | 'UpdateInstall'
  | 'UpdateUninstall'
  | 'DbInfo'
  | 'CloudflareInstall'
  | 'CloudflareStart'
  | 'CloudflareStop'
  | 'CloudflareStatus'
  | 'CloudflareSync'
  | 'CloudflareRotate'
  | 'CloudflareDelete'
  | 'CloudflareUninstall'
  | 'PortlessApply'
  | 'PortlessInstall'
  | 'PortlessStatus'
  | 'PortlessUninstall';

export type CommandDefinition = {
  name: CommandName;
  label: string;
  args: string[];
  disruptive: boolean;
  event: string;
};

export const commandRegistry: Record<CommandName, CommandDefinition> = {
  StackStart: {
    name: 'StackStart',
    label: 'Start stack',
    args: ['up'],
    disruptive: true,
    event: 'StackStart'
  },
  StackStop: {
    name: 'StackStop',
    label: 'Stop stack',
    args: ['down'],
    disruptive: true,
    event: 'StackStop'
  },
  StackConfigure: {
    name: 'StackConfigure',
    label: 'Configure stack',
    args: ['configure'],
    disruptive: true,
    event: 'Configure'
  },
  RestoreBackup: {
    name: 'RestoreBackup',
    label: 'Restore backup',
    args: ['backup', 'restore'],
    disruptive: true,
    event: 'Backup'
  },
  MigrateCurrentStack: {
    name: 'MigrateCurrentStack',
    label: 'Migrate current stack',
    args: ['migrate', 'run'],
    disruptive: true,
    event: 'Configure'
  },
  ApplyNamingPreset: {
    name: 'ApplyNamingPreset',
    label: 'Apply naming preset',
    args: ['naming', 'apply'],
    disruptive: false,
    event: 'Configure'
  },
  ApplyDownloadsPreset: {
    name: 'ApplyDownloadsPreset',
    label: 'Apply downloads preset',
    args: ['downloads', 'apply'],
    disruptive: false,
    event: 'Configure'
  },
  SecurityApply: {
    name: 'SecurityApply',
    label: 'Apply security credentials',
    args: ['security', 'apply'],
    disruptive: true,
    event: 'Configure'
  },
  ApplyRequestsPreset: {
    name: 'ApplyRequestsPreset',
    label: 'Apply requests preset',
    args: ['requests', 'apply'],
    disruptive: false,
    event: 'Configure'
  },
  ClearRequestsPreset: {
    name: 'ClearRequestsPreset',
    label: 'Clear requests preset',
    args: ['requests', 'clear'],
    disruptive: false,
    event: 'Configure'
  },
  Backup: {
    name: 'Backup',
    label: 'Run backup',
    args: ['backup', 'run'],
    disruptive: false,
    event: 'Backup'
  },
  BackupPermissions: {
    name: 'BackupPermissions',
    label: 'Check backup access',
    args: ['backup', 'permissions'],
    disruptive: false,
    event: 'Configure'
  },
  Update: {
    name: 'Update',
    label: 'Update stack',
    args: ['update', 'run'],
    disruptive: true,
    event: 'Update'
  },
  PlexCheck: {
    name: 'PlexCheck',
    label: 'Check Plex identity',
    args: ['plex-check'],
    disruptive: false,
    event: 'Health'
  },
  PermissionsAudit: {
    name: 'PermissionsAudit',
    label: 'Audit permissions',
    args: ['permissions', 'audit'],
    disruptive: false,
    event: 'Health'
  },
  PermissionsFix: {
    name: 'PermissionsFix',
    label: 'Fix permissions',
    args: ['permissions', 'fix'],
    disruptive: true,
    event: 'Configure'
  },
  StartupInstall: {
    name: 'StartupInstall',
    label: 'Enable startup automation',
    args: ['startup', 'install'],
    disruptive: false,
    event: 'Configure'
  },
  StartupUninstall: {
    name: 'StartupUninstall',
    label: 'Disable startup automation',
    args: ['startup', 'uninstall'],
    disruptive: false,
    event: 'Configure'
  },
  BackupInstall: {
    name: 'BackupInstall',
    label: 'Enable backup automation',
    args: ['backup', 'install'],
    disruptive: false,
    event: 'Configure'
  },
  BackupUninstall: {
    name: 'BackupUninstall',
    label: 'Disable backup automation',
    args: ['backup', 'uninstall'],
    disruptive: false,
    event: 'Configure'
  },
  UpdateInstall: {
    name: 'UpdateInstall',
    label: 'Enable update automation',
    args: ['update', 'install'],
    disruptive: false,
    event: 'Configure'
  },
  UpdateUninstall: {
    name: 'UpdateUninstall',
    label: 'Disable update automation',
    args: ['update', 'uninstall'],
    disruptive: false,
    event: 'Configure'
  },
  DbInfo: {
    name: 'DbInfo',
    label: 'Database info',
    args: ['db-info'],
    disruptive: false,
    event: 'Health'
  },
  CloudflareInstall: {
    name: 'CloudflareInstall',
    label: 'Install Cloudflare tunnel',
    args: ['cloudflare', 'install'],
    disruptive: false,
    event: 'Configure'
  },
  CloudflareStart: {
    name: 'CloudflareStart',
    label: 'Start Cloudflare tunnel',
    args: ['cloudflare', 'start'],
    disruptive: false,
    event: 'Configure'
  },
  CloudflareStop: {
    name: 'CloudflareStop',
    label: 'Stop Cloudflare tunnel',
    args: ['cloudflare', 'stop'],
    disruptive: false,
    event: 'Configure'
  },
  CloudflareStatus: {
    name: 'CloudflareStatus',
    label: 'Cloudflare status',
    args: ['cloudflare', 'status'],
    disruptive: false,
    event: 'Health'
  },
  CloudflareSync: {
    name: 'CloudflareSync',
    label: 'Sync Cloudflare settings',
    args: ['cloudflare', 'sync'],
    disruptive: false,
    event: 'Configure'
  },
  CloudflareRotate: {
    name: 'CloudflareRotate',
    label: 'Rotate Cloudflare connector credential',
    args: ['cloudflare', 'rotate'],
    disruptive: true,
    event: 'Configure'
  },
  CloudflareDelete: {
    name: 'CloudflareDelete',
    label: 'Delete Cloudflare tunnel',
    args: ['cloudflare', 'delete'],
    disruptive: true,
    event: 'Configure'
  },
  CloudflareUninstall: {
    name: 'CloudflareUninstall',
    label: 'Uninstall Cloudflare tunnel',
    args: ['cloudflare', 'uninstall'],
    disruptive: true,
    event: 'Configure'
  },
  PortlessApply: {
    name: 'PortlessApply',
    label: 'Apply Portless aliases',
    args: ['portless', 'apply'],
    disruptive: false,
    event: 'Configure'
  },
  PortlessInstall: {
    name: 'PortlessInstall',
    label: 'Install Portless agent',
    args: ['portless', 'install'],
    disruptive: false,
    event: 'Configure'
  },
  PortlessStatus: {
    name: 'PortlessStatus',
    label: 'Portless status',
    args: ['portless', 'status'],
    disruptive: false,
    event: 'Health'
  },
  PortlessUninstall: {
    name: 'PortlessUninstall',
    label: 'Uninstall Portless agent',
    args: ['portless', 'uninstall'],
    disruptive: false,
    event: 'Configure'
  }
};

export function getCommand(name: string): CommandDefinition | undefined {
  return commandRegistry[name as CommandName];
}
