import { getToolCatalog, listAgentActivityRecords } from '@stackarr/core';
import Link from 'next/link';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { Grid, Panel, Stat } from '../../components/ui';

export default async function AgentPage() {
  const tools = getToolCatalog();
  const activity = await listAgentActivityRecords(25);
  return (
    <>
      <Toolbar title="Agent Automation" />
      <PageBody>
        <Grid>
          <Stat label="MCP transport" value="local stdio" tone="good" />
          <Stat label="Tools" value={String(tools.length)} tone="neutral" />
          <Stat label="Recent calls" value={String(activity.length)} tone="neutral" />
        </Grid>
        <Panel title="Local MCP setup">
          <p>
            Stackarr exposes typed, audited tools for local personal agents. Remote MCP is intentionally not enabled in
            V1.
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
