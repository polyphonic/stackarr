import { getMcpProfileDescription, getMcpServiceSelection, getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import Link from 'next/link';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { Grid, Panel, Stat } from '../../components/ui';
import { requireDashboardAuth } from '../../lib/serverAuth';

export default async function AgentPage() {
  await requireDashboardAuth('/agent');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const selection = getMcpServiceSelection();
  return (
    <>
      <Toolbar title="Chat Control" />
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
      </PageBody>
    </>
  );
}
