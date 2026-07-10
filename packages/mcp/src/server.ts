import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveMcpProfile } from '@stackarr/core';
import { getRegisteredControlPlaneSummary, registerStackarrTools } from './registry';

export function createStackarrMcpServer() {
  const profile = resolveMcpProfile();
  const summary = getRegisteredControlPlaneSummary(profile);
  const server = new McpServer(
    { name: 'stackarr', version: '0.3.0-alpha.1' },
    {
      instructions: [
        'Stackarr is a local homelab control plane. Prefer typed native-service actions over shell commands.',
        `Active authority profile: ${profile} — ${summary.description}`,
        `Approval mode: ${summary.approvalMode}.`,
        `Selected tool groups: ${Array.isArray(summary.selectedGroups) ? summary.selectedGroups.join(', ') : summary.selectedGroups}.`,
        'Use stackarr_get_mcp_control_plane to inspect enabled service groups and available actions.',
        'Dry-run setup, migration, and restore operations before executing them. Never ask for passwords or API keys through MCP elicitation.',
        'After enabling or disabling services, restart the MCP connection so the advertised tool catalog is refreshed.'
      ].join('\n')
    }
  );
  registerStackarrTools(server, profile);
  return server;
}
