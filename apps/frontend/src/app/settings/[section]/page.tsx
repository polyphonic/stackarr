import { getServices, readEnv, readJsonPreset, readSettings, redactEnv } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { SettingsEditor } from '../../../components/SettingsEditor';
import { SubNav } from '../../../components/SubNav';
import { Badge, Panel, Table } from '../../../components/ui';

export const dynamic = 'force-dynamic';

const titles: Record<string, string> = {
  mediamanagement: 'Media Management',
  profiles: 'Profiles',
  services: 'Services',
  downloadclients: 'Download Clients',
  indexers: 'Indexers',
  connect: 'Connect',
  metadata: 'Metadata',
  account: 'Account',
  security: 'Security',
  general: 'General',
  ui: 'UI'
};

const navItems = Object.entries(titles).map(([slug, label]) => ({
  href: `/settings/${slug}`,
  label
}));

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const env = readEnv();
  const safeEnv = redactEnv(env);
  const settings = readSettings();
  const mediaServers = getServices().filter((service) => service.category === 'media');
  const { section } = await params;
  const title = titles[section] ?? 'Settings';

  return (
    <>
      <Toolbar title={title} />
      <PageBody>
        <SubNav items={navItems} />
        {section === 'mediamanagement' && (
          <Panel title="Root Folders and Media Servers">
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
            <Table>
              <tbody>
                <tr>
                  <th>Media Root</th>
                  <td>{env.MEDIA_ROOT}</td>
                </tr>
                <tr>
                  <th>Music Root</th>
                  <td>{env.MUSIC_ROOT}</td>
                </tr>
                <tr>
                  <th>Downloads Root</th>
                  <td>{env.DOWNLOADS_ROOT}</td>
                </tr>
                <tr>
                  <th>Backup Root</th>
                  <td>{env.BACKUP_ROOT}</td>
                </tr>
                <tr>
                  <th>Backup Time</th>
                  <td>{env.BACKUP_TIME ?? '02:00'}</td>
                </tr>
                <tr>
                  <th>Backup Schedule</th>
                  <td>{env.BACKUP_SCHEDULE === 'weekly' ? `Weekly on ${env.BACKUP_WEEKDAY ?? 'Sun'}` : 'Daily'}</td>
                </tr>
                <tr>
                  <th>Backup Retention</th>
                  <td>{env.BACKUP_RETENTION_COUNT ?? '52'} latest archive(s)</td>
                </tr>
                {mediaServers.map((service) => (
                  <tr key={service.name}>
                    <th>{service.name}</th>
                    <td>
                      <Badge tone={service.detected ? 'good' : 'purple'}>
                        {service.mode}
                        {service.detected ? ' detected' : ''}
                      </Badge>{' '}
                      {service.configPath}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}
        {section === 'profiles' && (
          <Panel title="Profiles">
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
          </Panel>
        )}
        {section === 'services' && (
          <Panel title="Service Selection">
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
          </Panel>
        )}
        {section === 'profiles' && (
          <Panel title="Underlying Presets">
            <pre>
              {JSON.stringify({ naming: readJsonPreset('naming'), requests: readJsonPreset('requests') }, null, 2)}
            </pre>
          </Panel>
        )}
        {section === 'downloadclients' && (
          <Panel title="Download Client Defaults">
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
            <Table>
              <tbody>
                <tr>
                  <th>Preferred Client</th>
                  <td>{env.PREFERRED_TORRENT_CLIENT ?? 'transmission'}</td>
                </tr>
                <tr>
                  <th>Transmission Bind</th>
                  <td>{env.TRANSMISSION_BIND_IP ?? '127.0.0.1'}</td>
                </tr>
                <tr>
                  <th>qBittorrent Bind</th>
                  <td>{env.QBITTORRENT_BIND_IP ?? '127.0.0.1'}</td>
                </tr>
              </tbody>
            </Table>
          </Panel>
        )}
        {section === 'connect' && (
          <Panel title="Cloudflare and Public Access">
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
            <p>
              Only explicit Stackarr integrations are shown here: API sync, config writes, webhook events, and public
              URL publishing.
            </p>
            <p>
              <Badge tone="purple">Events</Badge> Test, Health, StackStart, StackStop, Configure, Backup, Update,
              ServiceStateChange, SetupComplete.
            </p>
          </Panel>
        )}
        {['indexers', 'metadata', 'account', 'security', 'general', 'ui'].includes(section) && (
          <Panel title={title}>
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
          </Panel>
        )}
      </PageBody>
    </>
  );
}
