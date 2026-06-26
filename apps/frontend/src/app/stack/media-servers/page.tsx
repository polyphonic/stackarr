import { getServices, getSystemStatus, readEnv } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Badge, Grid, Panel, Stat, Table } from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default function MediaServersPage() {
  const env = readEnv();
  const status = getSystemStatus();
  const mediaServers = getServices().filter((service) => service.category === 'media');

  return (
    <>
      <Toolbar title="Media Servers" />
      <PageBody>
        <Grid>
          <Stat
            label="Plex Mode"
            value={String(status.plexInstallMode ?? env.PLEX_INSTALL_MODE ?? 'native')}
            tone="purple"
          />
          <Stat
            label="Jellyfin Mode"
            value={String(status.jellyfinInstallMode ?? env.JELLYFIN_INSTALL_MODE ?? 'disabled')}
            tone="neutral"
          />
          <Stat label="Hardware Transcoding" value="Choose native or Docker per server" tone="warn" />
        </Grid>
        <Panel title="Native Discovery">
          <Table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Mode</th>
                <th>Detected</th>
                <th>Config Path</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {mediaServers.map((service) => (
                <tr key={service.name}>
                  <td>{service.name}</td>
                  <td>
                    <Badge tone={service.mode === 'docker' ? 'purple' : 'neutral'}>{service.mode}</Badge>
                  </td>
                  <td>
                    <Badge tone={service.detected ? 'good' : 'warn'}>{service.detected ? 'yes' : 'not found'}</Badge>
                  </td>
                  <td>{service.configPath}</td>
                  <td>{service.notes?.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel title="Server Strategy">
          <p>
            Plex and Jellyfin are independent Stackarr choices. Native mode keeps the media server outside Docker for
            direct macOS hardware access. Docker mode adds the matching compose profile when Stackarr starts the stack.
          </p>
          <p>
            If a native Plex or Jellyfin install already exists, Stackarr treats it as detected infrastructure for
            monitoring and feature wiring instead of trying to reinstall it.
          </p>
          <p>
            <Badge tone="purple">macOS first</Badge> Stackarr now expects any Docker-compatible runtime instead of a
            vendor-specific desktop app.
          </p>
        </Panel>
      </PageBody>
    </>
  );
}
