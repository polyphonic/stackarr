import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type McpProfile, resolveMcpProfile, stackarrVersion, type ToolCategory } from '@stackarr/core';
import { getRegisteredControlPlaneSummary, registerStackarrTools } from './registry';

export function createStackarrMcpServer(
  options: { profile?: McpProfile; groups?: ToolCategory[]; caller?: `mcp-remote:${string}` | 'mcp-local' } = {}
) {
  const profile = options.profile ?? resolveMcpProfile();
  const summary = getRegisteredControlPlaneSummary(profile, { groups: options.groups });
  const server = new McpServer(
    { name: 'stackarr', version: stackarrVersion },
    {
      instructions: [
        'Stackarr is a local homelab control plane. Prefer typed native-service actions over shell commands.',
        `Active authority profile: ${profile} — ${summary.description}`,
        `Approval mode: ${summary.approvalMode}.`,
        `Catalog mode: ${summary.catalogMode}.`,
        `Selected tool groups: ${Array.isArray(summary.selectedGroups) ? summary.selectedGroups.join(', ') : summary.selectedGroups}.`,
        `Next step: ${summary.nextStep}`,
        'Use stackarr_get_mcp_control_plane to inspect enabled service groups and available actions.',
        'Dry-run setup, migration, and restore operations before executing them. Never ask for passwords or API keys through MCP elicitation.',
        'After enabling or disabling services, restart the MCP connection so the advertised tool catalog is refreshed.'
      ].join('\n')
    }
  );
  registerStackarrTools(server, profile, { groups: options.groups, caller: options.caller });
  return server;
}
