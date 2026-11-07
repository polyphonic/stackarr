import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type McpProfile, resolveMcpProfile, stackarrVersion, type ToolCategory } from '@stackarr/core';
import { getRegisteredControlPlaneSummary, registerStackarrTools } from './registry';

export function createStackarrMcpServer(
  options: {
    profile?: McpProfile;
    groups?: ToolCategory[];
    caller?: `mcp-remote:${string}` | 'mcp-local' | `mcp-local:${string}`;
  } = {}
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
        'After enabling or disabling services, restart the MCP connection so the advertised tool catalog is refreshed.',
        'Native/external database mode connects to an existing reachable server; it does not provision databases, move data, restore backups, or migrate applications. Keep managed unified TimescaleDB as the default unless prerequisites are met.',
        'Before choosing external PostgreSQL, verify engine/version/extensions, per-app roles/databases, connectivity/TLS, and a tested matching-engine restore. Record original endpoints and a rollback plan. Backups cover configured source and reachable archive target only when enabled, credentials and schedules work, and local/full-file plus remote archive captures and restores have been verified; saving a URL is not backup coverage.',
        'Use read-only database diagnostics and preview before changing an endpoint. Never infer a successful migration from connection success. General settings writes and secrets remain on authenticated settings UI until shared route validators are available.'
      ].join('\n')
    }
  );
  registerStackarrTools(server, profile, { groups: options.groups, caller: options.caller ?? localCaller() });
  return server;
}

function localCaller(): 'mcp-local' | `mcp-local:${string}` {
  const client = process.env.STACKARR_MCP_CLIENT?.trim().toLowerCase();
  return client && /^[a-z0-9][a-z0-9_.-]{0,31}$/.test(client) ? `mcp-local:${client}` : 'mcp-local';
}
