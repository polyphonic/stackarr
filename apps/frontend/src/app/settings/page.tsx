import { PageBody, Toolbar } from '../../components/AppFrame';
import { DestinationCard } from '../../components/DestinationCard';
import { icons } from '../../components/icons';
import { Grid, Panel } from '../../components/ui';
import { requireDashboardAuth } from '../../lib/serverAuth';

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
  ['account', 'Account', 'Stackarr sign-in, global identity, service owner email, and API key'],
  ['security', 'Security', 'Per-service passwords and isolated Postgres role credentials'],
  ['general', 'General', 'API key, timezone, update windows, and paths'],
  ['ui', 'UI', 'Theme and display preferences']
];

export default async function SettingsPage() {
  await requireDashboardAuth('/settings');

  return (
    <>
      <Toolbar
        title="Settings"
        description="Start with common choices, then open advanced controls only when you need them"
      />
      <PageBody>
        <Panel title="Everyday setup" description="The choices that shape how your libraries and apps behave">
          <Grid>
            {settings
              .filter(([slug]) => ['mediamanagement', 'services', 'downloadclients'].includes(slug))
              .map(([slug, title, summary], index) => (
                <DestinationCard
                  key={slug}
                  href={`/settings/${slug}`}
                  icon={[icons.tv, icons.stack, icons.download][index]!}
                  title={title}
                  description={summary}
                />
              ))}
            <DestinationCard
              href="/settings/metadata"
              icon={icons.image}
              title="Metadata"
              description="Scanning, artwork, scraping, and TinyMediaManager behavior"
            />
          </Grid>
        </Panel>
        <Panel title="Connections & identity" description="Remote access, app integrations, sign-in, and secrets">
          <Grid>
            <DestinationCard
              href="/settings/connect"
              icon={icons.cloud}
              title="Remote access"
              description="Cloudflare tunnel routes, webhooks, and public URLs"
            />
            <DestinationCard
              href="/settings/account"
              icon={icons.key}
              title="Account"
              description="Dashboard sign-in, owner identity, and API access"
            />
            <DestinationCard
              href="/settings/security"
              icon={icons.lock}
              title="Security"
              description="Service credentials and isolated database roles"
            />
          </Grid>
        </Panel>
        <Panel title="Advanced" description="Fine-grained presets, integrations, maintenance, and presentation">
          <Grid>
            {settings
              .filter(([slug]) => ['profiles', 'indexers', 'general', 'ui'].includes(slug))
              .map(([slug, title, summary], index) => (
                <DestinationCard
                  key={slug}
                  href={`/settings/${slug}`}
                  icon={[icons.sliders, icons.search, icons.wrench, icons.eye][index]!}
                  title={title}
                  description={summary}
                />
              ))}
            <DestinationCard
              href="/system/status"
              icon={icons.system}
              title="System & maintenance"
              description="Backups, updates, disk usage, events, and diagnostic status"
            />
          </Grid>
        </Panel>
      </PageBody>
    </>
  );
}
