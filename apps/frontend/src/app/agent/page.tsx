import {
  getMcpProfileDescription,
  getMcpToolCatalog,
  listAgentActivityRecords,
  resolveMcpProfile
} from '@stackarr/core';
import Link from 'next/link';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { Grid, Panel, Stat } from '../../components/ui';
import { requireDashboardAuth } from '../../lib/serverAuth';

export default async function AgentPage() {
  await requireDashboardAuth('/agent');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const activity = await listAgentActivityRecords(25);
  return (
    <>
      <Toolbar title="Agent Automation" />
      <PageBody>
        <Grid>
          <Stat label="MCP transport" value="local stdio" tone="good" />
          <Stat label="Authority" value={profile} tone={profile === 'unrestricted' ? 'warn' : 'purple'} />
          <Stat label="Tools" value={String(tools.length)} tone="neutral" />
          <Stat label="Recent calls" value={String(activity.length)} tone="neutral" />
        </Grid>
        <Panel title="Local MCP setup">
          <p>
            {getMcpProfileDescription(profile)} Destructive actions use approval prompts in the chat client unless the
            profile is unrestricted. Remote MCP is not enabled.
          </p>
          <p>
            <Link href="/agent/tools">View tool catalog</Link> · <Link href="/agent/activity">View activity</Link> ·{' '}
            <Link href="/agent/settings">Settings</Link>
          </p>
        </Panel>
      </PageBody>
    </>
  );
}
