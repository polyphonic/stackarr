import {
  getMcpConnectionKits,
  getMcpProfileDescription,
  getMcpServiceSelection,
  getMcpToolCatalog,
  type McpProfile,
  resolveMcpProfile
} from '@stackarr/core';
import { AgentConnectionKit } from '../../../components/AgentConnectionKit';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function AgentSettingsPage() {
  await requireDashboardAuth('/agent/settings');

  const profile = resolveMcpProfile();
  const tools = getMcpToolCatalog({ profile });
  const selection = getMcpServiceSelection();
  const profiles: McpProfile[] = ['observe', 'manage', 'admin', 'unrestricted'];
  const kitsByProfile = Object.fromEntries(
    profiles.map((candidate) => [candidate, getMcpConnectionKits({ profile: candidate })])
  ) as Record<McpProfile, ReturnType<typeof getMcpConnectionKits>>;

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
        <AgentConnectionKit kitsByProfile={kitsByProfile} initialProfile={profile} />
        <Panel title="Connection policy stays outside the agent">
          <p>
            The selected authority is part of the connection you install. An agent can generate these instructions, but
            it cannot install a stronger profile or promote its running connection by itself.
          </p>
        </Panel>
      </PageBody>
    </>
  );
}
