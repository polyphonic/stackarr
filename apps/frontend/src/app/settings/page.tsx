import { PageBody, Toolbar } from '../../components/AppFrame';
import { DestinationCard } from '../../components/DestinationCard';
import { icons } from '../../components/icons';
import { Grid, Panel } from '../../components/ui';
import { requireDashboardAuth } from '../../lib/serverAuth';

const settings = [
  ['mediamanagement', 'Media Management', 'Shared root folders, backup schedule, retention, and import paths'],
  ['profiles', 'Profiles', 'Stackarr presets for HD, 4K, and request routing'],
  ['connect', 'Connect', 'Stackarr integrations with other app APIs, configs, webhooks, and public URLs'],
  ['account', 'Account', 'Stackarr sign-in, global identity, service owner email, and API key'],
  ['general', 'General', 'API key, timezone, update windows, and paths'],
  ['ui', 'UI', 'Theme and display preferences']
];

export default async function SettingsPage() {
  await requireDashboardAuth('/settings');

  return (
    <>
      <Toolbar title="Settings" description="Shared storage, access, account, and dashboard preferences" />
      <PageBody>
        <Panel title="Your Stackarr Setup" description="Storage, defaults, and behavior shared across your homelab">
          <Grid>
            {settings
              .filter(([slug]) => ['mediamanagement'].includes(slug))
              .map(([slug, title, summary], index) => (
                <DestinationCard
                  key={slug}
                  href={`/settings/${slug}`}
                  icon={[icons.tv][index]!}
                  title={title}
                  description={summary}
                />
              ))}
            <DestinationCard
              href="/stack/services"
              icon={icons.stack}
              title="App Settings"
              description="Configure each app where you open and manage it"
            />
          </Grid>
        </Panel>
        <Panel title="Connections & Identity" description="Remote access, app integrations, sign-in, and secrets">
          <Grid>
            <DestinationCard
              href="/settings/connect"
              icon={icons.cloud}
              title="Remote Access"
              description="Cloudflare tunnel routes, webhooks, and public URLs"
            />
            <DestinationCard
              href="/settings/account"
              icon={icons.key}
              title="Account"
              description="Dashboard sign-in, owner identity, and API access"
            />
          </Grid>
        </Panel>
        <Panel title="Advanced" description="Fine-grained presets, integrations, maintenance, and presentation">
          <Grid>
            {settings
              .filter(([slug]) => ['profiles', 'general', 'ui'].includes(slug))
              .map(([slug, title, summary], index) => (
                <DestinationCard
                  key={slug}
                  href={`/settings/${slug}`}
                  icon={[icons.sliders, icons.wrench, icons.eye][index]!}
                  title={title}
                  description={summary}
                />
              ))}
            <DestinationCard
              href="/system/status"
              icon={icons.system}
              title="System & Maintenance"
              description="Backups, updates, disk usage, events, and diagnostic status"
            />
          </Grid>
        </Panel>
      </PageBody>
    </>
  );
}
