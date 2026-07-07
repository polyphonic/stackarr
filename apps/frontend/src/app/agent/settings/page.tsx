import { localTrustedPolicy, remoteRestrictedPolicy } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentSettingsPage() {
  await requireDashboardAuth('/agent/settings');

  const example = `mcp_servers:
  stackarr:
    command: "node"
    args: ["/absolute/path/to/Stackarr/packages/mcp/dist/index.js"]
    timeout: 120
    connect_timeout: 30
    sampling:
      enabled: false`;
  return (
    <>
      <Toolbar title="Agent Settings" />
      <PageBody>
        <Panel title="Hermes/OpenClaw local stdio config">
          <pre>{example}</pre>
        </Panel>
        <Panel title="Policy preview">
          <pre>{JSON.stringify({ localTrustedPolicy, remoteRestrictedPolicy }, null, 2)}</pre>
        </Panel>
      </PageBody>
    </>
  );
}
