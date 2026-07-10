#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  getMcpConnectionKit,
  isMcpClientId,
  type McpProfile,
  resolveMcpGroups,
  type ToolCategory
} from '@stackarr/core';
import { createStackarrMcpServer } from './server';

const command = process.argv[2] ?? 'serve';

if (command === 'config') {
  const kit = connectionKitFromArgs(process.argv.slice(3));
  process.stdout.write(renderConnectionKit(kit));
} else if (command === 'serve') {
  const server = createStackarrMcpServer();
  await server.connect(new StdioServerTransport());
} else {
  throw new Error('Usage: stackarr mcp serve | stackarr mcp config <client> [--profile PROFILE] [--groups GROUPS]');
}

function connectionKitFromArgs(args: string[]) {
  const client = args.shift()?.trim().toLowerCase();
  if (!client || !isMcpClientId(client)) {
    throw new Error('Choose a client: codex, claude, lmstudio, chatgpt, hermes, openclaw, or generic.');
  }

  let profile: McpProfile | undefined;
  let groups: ToolCategory[] | undefined;
  let containerName: string | undefined;
  let tunnelId: string | undefined;

  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`Missing value for ${flag}.`);

    if (flag === '--profile') {
      if (!['observe', 'manage', 'admin', 'unrestricted'].includes(value)) {
        throw new Error(`Unknown MCP profile: ${value}.`);
      }
      profile = value as McpProfile;
    } else if (flag === '--groups') {
      groups = resolveMcpGroups(value);
    } else if (flag === '--container-name') {
      containerName = value;
    } else if (flag === '--tunnel-id') {
      tunnelId = value;
    } else {
      throw new Error(`Unknown connection option: ${flag}.`);
    }
  }

  return getMcpConnectionKit({ client, profile, groups, containerName, tunnelId });
}

function renderConnectionKit(kit: ReturnType<typeof getMcpConnectionKit>) {
  const sections = [
    `${kit.label} · ${kit.transport}`,
    kit.summary,
    '',
    ...kit.steps.map((step, index) => `${index + 1}. ${step}`)
  ];

  if (kit.command) sections.push('', 'Command', kit.command);
  if (kit.config) sections.push('', 'Configuration', JSON.stringify(kit.config, null, 2));
  if (kit.warnings.length > 0) sections.push('', 'Important', ...kit.warnings.map((warning) => `- ${warning}`));
  sections.push('', 'First message', kit.verificationPrompt, '');
  return sections.join('\n');
}
