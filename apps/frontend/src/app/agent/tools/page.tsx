import { getMcpServiceSelection, getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import { AgentToolCatalog } from '../../../components/AgentToolCatalog';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentToolsPage() {
  await requireDashboardAuth('/agent/tools');
  const selection = getMcpServiceSelection();

  return (
    <>
      <Toolbar title="Available Agent Actions" />
      <PageBody>
        <Panel title={selection.onboardingComplete ? 'Filtered for your stack' : 'Setup catalog'}>
          <p>
            {selection.onboardingComplete
              ? 'Only actions for your configured apps are shown. Reconnect chat clients after changing enabled services.'
              : 'Stackarr keeps this list focused until setup is complete. App-specific actions appear after onboarding.'}
          </p>
        </Panel>
        <AgentToolCatalog tools={getMcpToolCatalog({ profile: resolveMcpProfile() })} />
      </PageBody>
    </>
  );
}
