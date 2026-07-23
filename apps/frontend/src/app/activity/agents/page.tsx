import { listAgentActivityRecords } from '@stackarr/core';
import { ActivityNav } from '../../../components/ActivityNav';
import { AgentToolCallTable } from '../../../components/AgentToolCallTable';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentActivityPage() {
  await requireDashboardAuth('/activity/agents');
  const records = await listAgentActivityRecords(200);

  return (
    <>
      <Toolbar title="Activity" description="Queued work, command history, agent calls, and server logs" />
      <ActivityNav />
      <PageBody>
        <AgentToolCallTable records={records} />
      </PageBody>
    </>
  );
}
