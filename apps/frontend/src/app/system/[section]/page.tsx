import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commandRegistry,
  getBackupRecoveryKeyStatusAction,
  getStackMetrics,
  getSystemStatus,
  readEnv,
  readTasks,
  type StackarrTask
} from '@stackarr/core';
import { notFound } from 'next/navigation';
import { ActivityNav } from '../../../components/ActivityNav';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { BackupRecoveryKey } from '../../../components/BackupRecoveryKey';
import { CommandButton } from '../../../components/CommandButton';
import { PortlessHostCommands } from '../../../components/PortlessHostCommands';
import { ServerLogViewer } from '../../../components/ServerLogViewer';
import { SubNav } from '../../../components/SubNav';
import { TaskProgressView } from '../../../components/TaskProgress';
import { ActionGrid, Badge, Grid, Panel, Stat, Table } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export const dynamic = 'force-dynamic';

const titles: Record<string, string> = {
  status: 'Status',
  tasks: 'Tasks',
  backup: 'Backup',
  updates: 'Updates',
  events: 'Events',
  logs: 'Log Files',
  diskspace: 'Disk Space'
};

const navItems = Object.entries(titles).map(([slug, label]) => ({
  href: `/system/${slug}`,
  label
}));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'purple';

export default async function SystemSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!Object.prototype.hasOwnProperty.call(titles, section)) notFound();
  await requireDashboardAuth(`/system/${section}`);

  const status = getSystemStatus();
  const env = readEnv();
  const metrics = getStackMetrics([
    env.MEDIA_ROOT ?? '',
    env.MUSIC_ROOT ?? '',
    env.DOWNLOADS_ROOT ?? '',
    env.BACKUP_ROOT ?? ''
  ]);
  const tasks = readTasks();
  const backupStatus = getBackupStatus(env, tasks);
  const backupRecoveryKeyStatus = getBackupRecoveryKeyStatusAction();

  return (
    <>
      <Toolbar
        title={section === 'logs' ? 'Activity' : (titles[section] ?? 'System')}
        description={section === 'logs' ? 'Active work, action history, and the server trail in one place' : undefined}
      />
      <PageBody>
        {section === 'logs' ? <ActivityNav /> : <SubNav items={navItems} />}
        {section === 'status' && (
          <>
            <Grid>
              <Stat label="Version" value={`v${status.version} · ${status.branch}`} tone="neutral" />
              <Stat label="OS" value={`${status.os.platform} ${status.os.arch}`} tone="neutral" />
              <Stat
                label="CLI"
                value={status.cliPresent ? 'Present' : 'Missing'}
                tone={status.cliPresent ? 'good' : 'bad'}
              />
              <Stat
                label="Compose"
                value={status.composeFilePresent ? 'Present' : 'Missing'}
                tone={status.composeFilePresent ? 'good' : 'bad'}
              />
              <Stat
                label="Docker Running"
                value={
                  metrics.serviceCounts.dockerRunning === null ? 'Unknown' : String(metrics.serviceCounts.dockerRunning)
                }
                tone={metrics.serviceCounts.dockerRunning === null ? 'warn' : 'good'}
              />
            </Grid>
            <Panel title="Stack Actions">
              <ActionGrid>
                <CommandButton name="StackStart" label={commandRegistry.StackStart.label} disruptive />
                <CommandButton name="StackStop" label={commandRegistry.StackStop.label} disruptive />
                <CommandButton name="StackConfigure" label={commandRegistry.StackConfigure.label} disruptive />
                <CommandButton name="PlexCheck" label={commandRegistry.PlexCheck.label} />
                <CommandButton name="DbInfo" label={commandRegistry.DbInfo.label} />
                <CommandButton name="PermissionsAudit" label={commandRegistry.PermissionsAudit.label} />
                <CommandButton name="PermissionsFix" label={commandRegistry.PermissionsFix.label} disruptive />
              </ActionGrid>
            </Panel>
            <Panel title="Paths">
              <Table>
                <tbody>
                  <tr>
                    <th>Runtime config database</th>
                    <td>{status.paths.databasePath}</td>
                  </tr>
                  {status.paths.databaseLogPath && (
                    <tr>
                      <th>Runtime log database</th>
                      <td>{status.paths.databaseLogPath}</td>
                    </tr>
                  )}
                  <tr>
                    <th>Compose</th>
                    <td>{status.paths.composePath}</td>
                  </tr>
                  <tr>
                    <th>CLI</th>
                    <td>{status.paths.stackarrBin}</td>
                  </tr>
                </tbody>
              </Table>
            </Panel>
          </>
        )}
        {section === 'tasks' && (
          <>
            <Panel title="Preset Actions">
              <ActionGrid>
                <CommandButton name="ApplyNamingPreset" label={commandRegistry.ApplyNamingPreset.label} />
                <CommandButton name="ApplyDownloadsPreset" label={commandRegistry.ApplyDownloadsPreset.label} />
                <CommandButton name="ApplyRequestsPreset" label={commandRegistry.ApplyRequestsPreset.label} />
              </ActionGrid>
            </Panel>
            <Panel title="Tasks">
              <Table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Status</th>
                    <th>Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td>{task.commandLabel}</td>
                      <td>
                        <Badge
                          tone={
                            task.status === 'failed'
                              ? 'bad'
                              : task.status === 'blocked'
                                ? 'warn'
                                : task.status === 'completed'
                                  ? 'good'
                                  : 'purple'
                          }
                        >
                          {task.status}
                        </Badge>
                      </td>
                      <td>{task.queuedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          </>
        )}
        {section === 'backup' && (
          <>
            <Grid>
              <Stat label="Schedule" value={backupStatus.scheduleLabel} tone={backupStatus.enabled ? 'good' : 'warn'} />
              <Stat label="Automation" value={backupStatus.agentLabel} tone={backupStatus.agentTone} />
              <Stat label="Last Attempt" value={backupStatus.lastAttemptLabel} tone={backupStatus.lastAttemptTone} />
              <Stat
                label="Latest Archive"
                value={backupStatus.latestArchiveLabel}
                tone={backupStatus.latestArchiveTone}
              />
              <Stat
                label="Recovery Key"
                value={recoveryKeyStatusLabel(backupRecoveryKeyStatus)}
                tone={recoveryKeyStatusTone(backupRecoveryKeyStatus)}
              />
            </Grid>
            <Panel title="Backup Actions">
              <ActionGrid>
                <CommandButton name="Backup" label={commandRegistry.Backup.label} />
                <CommandButton name="BackupInstall" label={commandRegistry.BackupInstall.label} />
                <CommandButton name="BackupPermissions" label={commandRegistry.BackupPermissions.label} />
                <CommandButton name="BackupUninstall" label={commandRegistry.BackupUninstall.label} />
              </ActionGrid>
            </Panel>
            <BackupRecoveryKey initialStatus={backupRecoveryKeyStatus} />
            <Panel title="Automation">
              <Table>
                <tbody>
                  <tr>
                    <th>Backup Root</th>
                    <td className="pathValue">{backupStatus.backupRoot}</td>
                  </tr>
                  <tr>
                    <th>Mount Access</th>
                    <td>
                      <Badge tone={backupStatus.accessTone}>{backupStatus.accessLabel}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <th>Access Target</th>
                    <td className="pathValue">{backupStatus.permissionTarget}</td>
                  </tr>
                  <tr>
                    <th>Run Target</th>
                    <td className="pathValue">{backupStatus.launchTarget}</td>
                  </tr>
                </tbody>
              </Table>
            </Panel>
            <Panel title="Latest Backup Attempt">
              {backupStatus.latestTask ? (
                <Table>
                  <tbody>
                    <tr>
                      <th>Task</th>
                      <td>{backupStatus.latestTask.commandLabel}</td>
                    </tr>
                    <tr>
                      <th>Status</th>
                      <td>
                        <Badge tone={taskTone(backupStatus.latestTask)}>{backupStatus.latestTask.status}</Badge>
                      </td>
                    </tr>
                    <tr>
                      <th>Progress</th>
                      <td>
                        <TaskProgressView task={backupStatus.latestTask} />
                      </td>
                    </tr>
                    <tr>
                      <th>Queued</th>
                      <td>{backupStatus.latestTask.queuedAt}</td>
                    </tr>
                    <tr>
                      <th>Finished</th>
                      <td>{backupStatus.latestTask.endedAt ?? '-'}</td>
                    </tr>
                  </tbody>
                </Table>
              ) : (
                <Table>
                  <tbody>
                    <tr>
                      <th>Status</th>
                      <td>No backup attempt has been recorded yet.</td>
                    </tr>
                  </tbody>
                </Table>
              )}
            </Panel>
          </>
        )}
        {section === 'updates' && (
          <Panel
            title="Updates"
            description="Update managed apps without interrupting Stackarr, or update the controller separately as a final handoff."
          >
            <ActionGrid>
              <CommandButton name="Update" label={commandRegistry.Update.label} disruptive />
              <CommandButton name="UpdateStackarr" label={commandRegistry.UpdateStackarr.label} disruptive />
              <CommandButton name="UpdateInstall" label={commandRegistry.UpdateInstall.label} />
              <CommandButton name="UpdateUninstall" label={commandRegistry.UpdateUninstall.label} />
            </ActionGrid>
          </Panel>
        )}
        {section === 'events' && (
          <>
            <Panel title="Startup Automation">
              <ActionGrid>
                <CommandButton name="StartupInstall" label={commandRegistry.StartupInstall.label} />
                <CommandButton name="StartupUninstall" label={commandRegistry.StartupUninstall.label} />
              </ActionGrid>
            </Panel>
            <Panel title="Cloudflare Tunnel">
              <ActionGrid>
                <CommandButton name="CloudflareStatus" label={commandRegistry.CloudflareStatus.label} />
                <CommandButton name="CloudflareInstall" label={commandRegistry.CloudflareInstall.label} />
                <CommandButton name="CloudflareStart" label={commandRegistry.CloudflareStart.label} />
                <CommandButton name="CloudflareStop" label={commandRegistry.CloudflareStop.label} />
                <CommandButton name="CloudflareSync" label={commandRegistry.CloudflareSync.label} />
                <CommandButton name="CloudflareRotate" label={commandRegistry.CloudflareRotate.label} disruptive />
                <CommandButton name="CloudflareDelete" label={commandRegistry.CloudflareDelete.label} disruptive />
                <CommandButton
                  name="CloudflareUninstall"
                  label={commandRegistry.CloudflareUninstall.label}
                  disruptive
                />
              </ActionGrid>
            </Panel>
            <Panel title="Portless" description="Host-managed local app aliases">
              <PortlessHostCommands />
            </Panel>
          </>
        )}
        {section === 'diskspace' && (
          <Panel title="Disk Space">
            <Table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Stackarr Paths</th>
                  <th>Used</th>
                  <th>Total</th>
                  <th>Free</th>
                </tr>
              </thead>
              <tbody>
                {metrics.disks.map((disk) => (
                  <tr key={disk.path}>
                    <td>{disk.label}</td>
                    <td>{disk.paths.length}</td>
                    <td>{disk.usedPercent === null ? 'Unavailable' : `${disk.usedPercent}%`}</td>
                    <td>{disk.totalSpace === null ? '' : `${Math.round(disk.totalSpace / 1024 / 1024 / 1024)} GB`}</td>
                    <td>{disk.freeSpace === null ? '' : `${Math.round(disk.freeSpace / 1024 / 1024 / 1024)} GB`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}
        {section === 'logs' && (
          <Panel
            title="Server Logs"
            description="A redacted tail of local Stackarr log files; nothing is sent elsewhere"
          >
            <ServerLogViewer />
          </Panel>
        )}
      </PageBody>
    </>
  );
}

function getBackupStatus(env: ReturnType<typeof readEnv>, tasks: StackarrTask[]) {
  const enabled = !String(env.ENABLE_BACKUP ?? 'true').match(/^(0|false|no|off|disabled)$/i);
  const schedule = String(env.BACKUP_SCHEDULE ?? 'weekly').toLowerCase();
  const time = env.BACKUP_TIME ?? '02:00';
  const weekday = env.BACKUP_WEEKDAY ?? 'Sun';
  const backupRoot = env.BACKUP_ROOT ?? '';
  const dockerRuntime = process.env.STACKARR_RUNTIME === 'docker';
  const stateRoot = env.STATE_ROOT ?? '';
  const helperApp = stateRoot ? path.join(stateRoot, 'launchd', 'Stackarr Backup Agent.app') : '';
  const helperBin = helperApp ? path.join(helperApp, 'Contents', 'MacOS', 'stackarr-backup-agent') : '';
  const stateLaunchAgentPath = stateRoot ? path.join(stateRoot, 'launchd', 'com.stackarr.backup.plist') : '';
  const hostLaunchAgentPath =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.stackarr.backup.plist')
      : '';
  const launchAgentPath = existingPath(hostLaunchAgentPath) ?? existingPath(stateLaunchAgentPath) ?? '';
  const launchAgentText = safeReadFile(launchAgentPath);
  const launchProgram = firstLaunchProgram(launchAgentText);
  const launchProgramApp = launchProgram ? appBundleForExecutable(launchProgram) : undefined;
  const permissionTarget = launchProgramApp ?? (helperBin && launchAgentText.includes(helperBin) ? helperApp : '');
  const helperInstalled = Boolean(helperBin && fs.existsSync(helperBin));
  const agentInstalled = Boolean(launchAgentText);
  const usesHelper = Boolean(launchProgramApp) || (helperInstalled && launchAgentText.includes(helperBin));
  const latestTask = tasks.find((task) => task.commandName === 'Backup');
  const latestArchive = latestBackupArchive(backupRoot);
  const externalRoot = backupRoot.startsWith('/Volumes/');
  const latestOutput = latestTask?.output ?? '';
  const accessDenied =
    /operation not permitted|could not access backup root|could not access backup staging root/i.test(latestOutput);

  if (dockerRuntime) {
    return {
      enabled,
      backupRoot: backupRoot || 'Not configured',
      scheduleLabel: enabled ? (schedule === 'daily' ? `Daily ${time}` : `${weekday} ${time}`) : 'Disabled',
      agentLabel: enabled ? 'Container' : 'Disabled',
      agentTone: enabled ? 'good' : 'warn',
      accessLabel: accessDenied ? 'Needs Access' : 'Audit Mounts',
      accessTone: accessDenied ? 'bad' : 'warn',
      permissionTarget: 'Docker/OrbStack shared folders',
      launchTarget: 'Stackarr container scheduler',
      lastAttemptLabel: latestTask ? latestTask.status : 'None',
      lastAttemptTone: latestTask ? taskTone(latestTask) : 'neutral',
      latestArchiveLabel: latestArchive ? `${latestArchive.name} (${formatBytes(latestArchive.size)})` : 'None',
      latestArchiveTone: latestArchive ? 'good' : 'neutral',
      latestTask
    } as const;
  }

  return {
    enabled,
    backupRoot: backupRoot || 'Not configured',
    scheduleLabel: enabled ? (schedule === 'daily' ? `Daily ${time}` : `${weekday} ${time}`) : 'Disabled',
    agentLabel: agentInstalled ? (usesHelper ? 'Installed' : 'Legacy') : 'Missing',
    agentTone: agentInstalled ? (usesHelper ? 'good' : 'warn') : 'bad',
    accessLabel: accessDenied
      ? 'Needs Access'
      : externalRoot
        ? usesHelper
          ? 'Review Access'
          : 'Install Agent'
        : 'Ready',
    accessTone: accessDenied || (externalRoot && !usesHelper) ? 'bad' : externalRoot ? 'warn' : 'good',
    permissionTarget: permissionTarget || helperApp || 'Enable backup automation',
    launchTarget: launchProgram || (agentInstalled ? 'Legacy stackarr command' : 'No launch agent installed'),
    lastAttemptLabel: latestTask ? latestTask.status : 'None',
    lastAttemptTone: latestTask ? taskTone(latestTask) : 'neutral',
    latestArchiveLabel: latestArchive ? `${latestArchive.name} (${formatBytes(latestArchive.size)})` : 'None',
    latestArchiveTone: latestArchive ? 'good' : 'neutral',
    latestTask
  } as const;
}

function taskTone(task: StackarrTask): Tone {
  if (task.status === 'failed') return 'bad';
  if (task.status === 'blocked') return 'warn';
  if (task.status === 'completed') return 'good';
  return 'purple';
}

function recoveryKeyStatusLabel(status: ReturnType<typeof getBackupRecoveryKeyStatusAction>) {
  if (!status.encryptionEnabled) return 'Not Used';
  if (!status.keyAvailable) return 'Not Generated';
  if (!status.keyValid) return 'Invalid';
  return status.exported ? 'Exported' : 'Export Required';
}

function recoveryKeyStatusTone(status: ReturnType<typeof getBackupRecoveryKeyStatusAction>): Tone {
  if (!status.encryptionEnabled) return 'neutral';
  if (status.keyAvailable && !status.keyValid) return 'bad';
  return status.exported ? 'good' : 'warn';
}

function latestBackupArchive(root: string | undefined) {
  if (!root || !fs.existsSync(root)) {
    return undefined;
  }

  try {
    return fs
      .readdirSync(root)
      .filter((name) => /^stackarr-backup-.+\.tar\.gz(?:\.enc)?$/.test(name))
      .map((name) => {
        const archivePath = path.join(root, name);
        const stat = fs.statSync(archivePath);
        return { name, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime)[0];
  } catch {
    return undefined;
  }
}

function safeReadFile(filePath: string) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function existingPath(filePath: string) {
  return filePath && fs.existsSync(filePath) ? filePath : undefined;
}

function firstLaunchProgram(plistText: string) {
  return plistText.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/s)?.[1];
}

function appBundleForExecutable(filePath: string) {
  const marker = '.app/Contents/MacOS/';
  const index = filePath.indexOf(marker);
  if (index === -1) {
    return undefined;
  }

  return `${filePath.slice(0, index)}.app`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}
