import { getMcpProfileDescription, getMcpServiceSelection, getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentSettingsPage() {
  await requireDashboardAuth('/agent/settings');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const selection = getMcpServiceSelection();
  const dockerExample = {
    mcpServers: {
      stackarr: {
        command: 'docker',
        args: ['exec', '-i', '-e', 'STACKARR_MCP_PROFILE=manage', 'app', '/app/bin/stackarr', 'mcp', 'serve']
      }
    }
  };

  return (
    <>
      <Toolbar title="Connect a Chat Client" />
      <PageBody>
        <Panel title="Current connection policy">
          <p>
            <strong>{profile}</strong> · {tools.length} actions · {getMcpProfileDescription(profile)}
          </p>
          <p>
            {selection.onboardingComplete
              ? 'The catalog is filtered to your configured apps.'
              : 'The catalog is limited to setup actions until onboarding is complete.'}{' '}
            Agents cannot promote their own profile.
          </p>
        </Panel>
        <Panel title="Docker MCP configuration">
          <p>Copy this into Codex, Claude, LM Studio, or another local MCP client on the Docker host.</p>
          <pre>{JSON.stringify(dockerExample, null, 2)}</pre>
          <p>
            Use admin for setup, manage for everyday operation, observe for read-only access, or unrestricted for full
            autonomy.
          </p>
        </Panel>
      </PageBody>
    </>
  );
}
