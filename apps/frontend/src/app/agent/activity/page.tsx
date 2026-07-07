import { listAgentActivityRecords } from '@stackarr/core';
import { AgentToolCallTable } from '../../../components/AgentToolCallTable';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentActivityPage() {
  await requireDashboardAuth('/agent/activity');

  const records = await listAgentActivityRecords(100);
  return (
    <>
      <Toolbar title="Agent Activity" />
      <PageBody>
        <AgentToolCallTable records={records} />
      </PageBody>
    </>
  );
}
