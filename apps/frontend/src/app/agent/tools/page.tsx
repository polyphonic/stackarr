import { getToolCatalog } from '@stackarr/core';
import { AgentToolCatalog } from '../../../components/AgentToolCatalog';
import { PageBody, Toolbar } from '../../../components/AppFrame';

export default function AgentToolsPage() {
  return (
    <>
      <Toolbar title="Agent Tools" />
      <PageBody>
        <AgentToolCatalog tools={getToolCatalog()} />
      </PageBody>
    </>
  );
}
