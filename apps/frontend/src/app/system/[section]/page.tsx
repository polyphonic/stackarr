import { commandRegistry, getStackMetrics, getSystemStatus, readEnv, readTasks } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { CommandButton } from '../../../components/CommandButton';
import { SubNav } from '../../../components/SubNav';
import { ActionGrid, Badge, Grid, Panel, Stat, Table } from '../../../components/ui';

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

export default async function SystemSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const status = getSystemStatus();
  const env = readEnv();
  const metrics = getStackMetrics([
    env.MEDIA_ROOT ?? '',
    env.MUSIC_ROOT ?? '',
    env.DOWNLOADS_ROOT ?? '',
    env.BACKUP_ROOT ?? ''
  ]);
  const tasks = readTasks();
  const { section } = await params;

  return (
    <>
      <Toolbar title={titles[section] ?? 'System'} />
      <PageBody>
        <SubNav items={navItems} />
        {section === 'status' && (
          <>
            <Grid>
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
          <Panel title="Backup">
            <ActionGrid>
              <CommandButton name="Backup" label={commandRegistry.Backup.label} />
              <CommandButton name="BackupInstall" label={commandRegistry.BackupInstall.label} />
              <CommandButton name="BackupUninstall" label={commandRegistry.BackupUninstall.label} />
            </ActionGrid>
          </Panel>
        )}
        {section === 'updates' && (
          <Panel title="Updates">
            <ActionGrid>
              <CommandButton name="Update" label={commandRegistry.Update.label} disruptive />
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
                <CommandButton name="CloudflareRotate" label={commandRegistry.CloudflareRotate.label} disruptive />
                <CommandButton name="CloudflareDelete" label={commandRegistry.CloudflareDelete.label} disruptive />
                <CommandButton
                  name="CloudflareUninstall"
                  label={commandRegistry.CloudflareUninstall.label}
                  disruptive
                />
              </ActionGrid>
            </Panel>
            <Panel title="Portless">
              <ActionGrid>
                <CommandButton name="PortlessStatus" label={commandRegistry.PortlessStatus.label} />
                <CommandButton name="PortlessApply" label={commandRegistry.PortlessApply.label} />
                <CommandButton name="PortlessInstall" label={commandRegistry.PortlessInstall.label} />
                <CommandButton name="PortlessUninstall" label={commandRegistry.PortlessUninstall.label} />
              </ActionGrid>
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
        {section !== 'status' &&
          section !== 'tasks' &&
          section !== 'backup' &&
          section !== 'updates' &&
          section !== 'events' &&
          section !== 'diskspace' && (
            <Panel title={titles[section] ?? 'System'}>
              <p>Stackarr endpoint support is available under `/api/v1/{section}` where applicable.</p>
            </Panel>
          )}
      </PageBody>
    </>
  );
}
