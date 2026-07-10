import { getServices, getSystemStatus, readEnv } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Badge, Grid, Panel, Stat, Table } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export const dynamic = 'force-dynamic';

export default async function MediaServersPage() {
  await requireDashboardAuth('/stack/media-servers');

  const env = readEnv();
  const status = getSystemStatus();
  const mediaServers = getServices().filter((service) => service.category === 'media');
  const plexMode = String(status.plexInstallMode ?? env.PLEX_INSTALL_MODE ?? 'docker');
  const jellyfinMode = String(status.jellyfinInstallMode ?? env.JELLYFIN_INSTALL_MODE ?? 'disabled');

  return (
    <>
      <Toolbar title="Media Servers" />
      <PageBody>
        <Grid>
          <Stat label="Plex" value={modeLabel(plexMode)} tone="purple" />
          <Stat label="Jellyfin" value={modeLabel(jellyfinMode)} tone="neutral" />
          <Stat label="Management" value="Container or existing server" tone="good" />
        </Grid>
        <Panel title="Server connections">
          <Table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Mode</th>
                <th>Available</th>
                <th>Config path</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {mediaServers.map((service) => (
                <tr key={service.name}>
                  <td>{service.displayName}</td>
                  <td>
                    <Badge tone={service.mode === 'docker' ? 'purple' : 'neutral'}>{modeLabel(service.mode)}</Badge>
                  </td>
                  <td>
                    <Badge tone={service.detected || service.mode === 'docker' ? 'good' : 'warn'}>
                      {service.detected || service.mode === 'docker' ? 'yes' : 'not found'}
                    </Badge>
                  </td>
                  <td>{service.configPath}</td>
                  <td>{service.notes?.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel title="Choose who owns the server">
          <p>
            A managed container is the simplest path: Stackarr owns its Compose service, health checks, and lifecycle
            actions. Choose an existing server when Plex or Jellyfin already runs outside the Stackarr Compose project.
          </p>
          <p>
            Existing servers keep their own process and hardware configuration. Stackarr connects for supported status,
            library, session, and integration actions without claiming container lifecycle control.
          </p>
        </Panel>
      </PageBody>
    </>
  );
}

function modeLabel(mode: string) {
  if (mode === 'docker') return 'Managed container';
  if (mode === 'native') return 'Existing server';
  return 'Disabled';
}
