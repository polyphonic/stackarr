import { listAgentActivityRecords } from '@stackarr/core';
import { AgentToolCallTable } from '../../../components/AgentToolCallTable';
import { PageBody, Toolbar } from '../../../components/AppFrame';

export default async function AgentActivityPage() {
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
