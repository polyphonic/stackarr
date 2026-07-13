import { readEnv, readJsonPreset, readSettings, redactEnv } from '@stackarr/core';
import { redirect } from 'next/navigation';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { SettingsEditor } from '../../../components/SettingsEditor';
import { SubNav } from '../../../components/SubNav';
import { Panel, Table } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export const dynamic = 'force-dynamic';

const titles: Record<string, string> = {
  mediamanagement: 'Media Management',
  profiles: 'Profiles',
  connect: 'Connect',
  account: 'Account',
  general: 'General',
  ui: 'UI'
};

const navItems = Object.entries(titles).map(([slug, label]) => ({
  href: `/settings/${slug}`,
  label
}));

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  await requireDashboardAuth(`/settings/${section}`);

  const env = readEnv();
  if (section === 'security') redirect('/stack/services');
  const appRedirect = appSettingsRedirect(section, env.PREFERRED_TORRENT_CLIENT);
  if (appRedirect) redirect(appRedirect);
  const safeEnv = redactEnv(env);
  const settings = readSettings();
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
              </tbody>
            </Table>
          </Panel>
        )}
        {section === 'profiles' && (
          <Panel title="Profiles">
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
        {section === 'connect' && (
          <Panel title="Cloudflare and Public Access">
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
            <p>
              Only explicit Stackarr integrations are shown here: API sync, config writes, webhook events, and public
              URL publishing.
            </p>
            <p>
              <strong>Events:</strong> Test, Health, StackStart, StackStop, Configure, Backup, Update,
              ServiceStateChange, SetupComplete.
            </p>
          </Panel>
        )}
        {['account', 'general', 'ui'].includes(section) && (
          <Panel title={title}>
            <SettingsEditor section={section} env={safeEnv} settings={settings} />
          </Panel>
        )}
      </PageBody>
    </>
  );
}

function appSettingsRedirect(section: string, preferredTorrentClient?: string) {
  if (section === 'services') return '/stack/services#add-app';
  if (section === 'downloadclients') {
    return `/stack/services?app=${preferredTorrentClient === 'qbittorrent' ? 'qbittorrent' : 'transmission'}`;
  }
  if (section === 'indexers') return '/stack/services?app=prowlarr';
  if (section === 'metadata') return '/stack/services?app=tinymediamanager';
  return null;
}
