import { getToolCatalog } from '@stackarr/core';
import { AgentToolCatalog } from '../../../components/AgentToolCatalog';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentToolsPage() {
  await requireDashboardAuth('/agent/tools');

  return (
    <>
      <Toolbar title="Agent Tools" />
      <PageBody>
        <AgentToolCatalog tools={getToolCatalog()} />
      </PageBody>
    </>
  );
}
