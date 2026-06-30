import Link from 'next/link';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { SubNav } from '../../components/SubNav';
import { Panel } from '../../components/ui';

const settings = [
  [
    'mediamanagement',
    'Media Management',
    'Root folders, Plex/Jellyfin modes, backup schedule, retention, and import paths'
  ],
  ['profiles', 'Profiles', 'Stackarr presets for HD, 4K, and request routing'],
  ['services', 'Services', 'Enable optional services, 4K Arr instances, and support tools'],
  ['downloadclients', 'Download Clients', 'Transmission, qBittorrent, queueing, seeding, and bind IPs'],
  ['indexers', 'Indexers', 'Prowlarr-managed indexers and proxy notes'],
  ['connect', 'Connect', 'Stackarr integrations with other app APIs, configs, webhooks, and public URLs'],
  ['metadata', 'Metadata', 'TinyMediaManager and media server metadata behavior'],
  ['security', 'Security', 'Shared and per-service passwords for app access and Postgres roles'],
  ['general', 'General', 'API key, timezone, update windows, and paths'],
  ['ui', 'UI', 'Theme and display preferences']
];

export default function SettingsPage() {
  return (
    <>
      <Toolbar title="Settings" />
      <PageBody>
        <SubNav items={settings.map(([slug, title]) => ({ href: `/settings/${slug}`, label: title }))} />
        <Panel title="Settings">
          <div>
            {settings.map(([slug, title, summary]) => (
              <p key={slug}>
                <Link href={`/settings/${slug}`}>
                  <strong>{title}</strong>
                </Link>
                <br />
                <span>{summary}</span>
              </p>
            ))}
          </div>
        </Panel>
      </PageBody>
    </>
  );
}
