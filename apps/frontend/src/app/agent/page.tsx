import {
  getAgentActionApiCatalog,
  getMcpProfileDescription,
  getMcpServiceSelection,
  getMcpToolCatalog,
  getNativeAppCapabilitiesAction,
  resolveMcpProfile
} from '@stackarr/core';
import { AgentExplorer } from '../../components/AgentExplorer';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { Grid, Stat } from '../../components/ui';
import { requireDashboardAuth } from '../../lib/serverAuth';

export default async function AgentPage() {
  await requireDashboardAuth('/agent');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const selection = getMcpServiceSelection();
  const capabilities = getNativeAppCapabilitiesAction();

  return (
    <>
      <Toolbar
        title="Agents"
        description="Inspect live app APIs, advertised actions, authority, and connection configuration"
      />
      <PageBody>
        <Grid>
          <Stat label="Transport" value="Local MCP" tone="good" />
          <Stat label="Authority" value={profile} tone={profile === 'unrestricted' ? 'warn' : 'purple'} />
          <Stat label="Advertised Actions" value={String(tools.length)} tone="neutral" />
          <Stat
            label="Catalog Scope"
            value={selection.onboardingComplete ? 'Installed Apps' : 'Setup Only'}
            tone={selection.onboardingComplete ? 'good' : 'warn'}
          />
        </Grid>
        <p>
          {getMcpProfileDescription(profile)} API contracts are read from installed apps at runtime; apps without a
          machine-readable contract are omitted from the explorer.
        </p>
        <AgentExplorer actions={getAgentActionApiCatalog(tools)} nativeCapabilities={capabilities.apps} />
      </PageBody>
    </>
  );
}
