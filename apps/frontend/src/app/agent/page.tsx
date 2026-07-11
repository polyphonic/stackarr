import { getMcpProfileDescription, getMcpServiceSelection, getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import Link from 'next/link';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { DestinationCard } from '../../components/DestinationCard';
import { icons } from '../../components/icons';
import { Grid, Panel, Stat } from '../../components/ui';
import { requireDashboardAuth } from '../../lib/serverAuth';

export default async function AgentPage() {
  await requireDashboardAuth('/agent');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const selection = getMcpServiceSelection();
  return (
    <>
      <Toolbar
        title="Automation & access"
        description="Connect agents, review their authority, and manage secure ways into your stack"
      />
      <PageBody>
        <Grid>
          <Stat label="Connection" value="Local MCP" tone="good" />
          <Stat label="Authority" value={profile} tone={profile === 'unrestricted' ? 'warn' : 'purple'} />
          <Stat label="Available actions" value={String(tools.length)} tone="neutral" />
          <Stat
            label="Catalog"
            value={selection.onboardingComplete ? 'Configured apps' : 'Setup only'}
            tone={selection.onboardingComplete ? 'good' : 'warn'}
          />
        </Grid>
        <Panel title="Manage Stackarr from your preferred chat">
          <p>
            {getMcpProfileDescription(profile)} Destructive actions ask in the chat client unless authority is
            unrestricted.
          </p>
          {!selection.onboardingComplete && (
            <p>Finish setup, then reconnect the chat client to load actions for the apps you selected.</p>
          )}
          <p>
            <Link href="/agent/settings">Connect a chat client</Link> · <Link href="/agent/tools">Browse actions</Link>{' '}
            · <Link href="/agent/activity">Review activity</Link>
          </p>
        </Panel>
        <Grid>
          <DestinationCard
            href="/agent/settings"
            icon={icons.link}
            title="Chat connections"
            description="Codex, Claude, ChatGPT, LM Studio, Hermes, and OpenClaw"
          />
          <DestinationCard
            href="/agent/activity"
            icon={icons.activity}
            title="Agent trail"
            description="See what each connection requested and what Stackarr did"
          />
          <DestinationCard
            href="/settings/connect"
            icon={icons.cloud}
            title="Remote access"
            description="Cloudflare routes, public URLs, and Access protection"
          />
          <DestinationCard
            href="/system/events"
            icon={icons.network}
            title="Tunnel controls"
            description="Install, sync, rotate, stop, or remove the Cloudflare tunnel"
          />
        </Grid>
        <Panel
          title="Peel back the layers"
          description="These controls are useful when you need to tune authority or inspect the action catalog"
        >
          <p>
            <Link href="/agent/tools">Browse available agent actions</Link> ·{' '}
            <Link href="/settings/security">Review security settings</Link> ·{' '}
            <Link href="/system/logs">Open server logs</Link>
          </p>
        </Panel>
      </PageBody>
    </>
  );
}
