import { getMcpProfileDescription, getMcpToolCatalog, resolveMcpProfile } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentSettingsPage() {
  await requireDashboardAuth('/agent/settings');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const localExample = {
    mcpServers: {
      stackarr: {
        command: 'stackarr',
        args: ['mcp', 'serve'],
        env: { STACKARR_MCP_PROFILE: 'manage' }
      }
    }
  };
  const dockerExample = {
    mcpServers: {
      stackarr: {
        command: 'docker',
        args: ['exec', '-i', '-e', 'STACKARR_MCP_PROFILE=manage', 'stackarr', '/app/bin/stackarr', 'mcp', 'serve']
      }
    }
  };

  return (
    <>
      <Toolbar title="Agent Settings" />
      <PageBody>
        <Panel title="Active authority">
          <p>
            <strong>{profile}</strong> · {tools.length} tools · {getMcpProfileDescription(profile)}
          </p>
          <p>The launch environment controls authority; agents cannot promote their own profile.</p>
        </Panel>
        <Panel title="Local stdio config">
          <pre>{JSON.stringify(localExample, null, 2)}</pre>
        </Panel>
        <Panel title="Docker host config">
          <pre>{JSON.stringify(dockerExample, null, 2)}</pre>
        </Panel>
      </PageBody>
    </>
  );
}
