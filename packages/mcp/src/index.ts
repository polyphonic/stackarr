#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  getMcpConnectionKit,
  getTelemetryStatusAction,
  isMcpClientId,
  type McpProfile,
  previewTelemetryPayloadAction,
  resolveMcpGroups,
  runDueRoutinesAction,
  sendTelemetryAction,
  type ToolCategory,
  updateTelemetryConfigAction
} from '@stackarr/core';
import { startStackarrMcpHttpServer } from './httpServer';
import { createStackarrMcpServer } from './server';

const command = process.argv[2] ?? 'serve';

if (command === 'config') {
  const kit = connectionKitFromArgs(process.argv.slice(3));
  process.stdout.write(renderConnectionKit(kit));
} else if (command === 'serve') {
  const server = createStackarrMcpServer();
  await server.connect(new StdioServerTransport());
} else if (command === 'routines' && process.argv[3] === 'run-due') {
  process.stdout.write(`${JSON.stringify(await runDueRoutinesAction())}\n`);
} else if (command === 'telemetry') {
  await runTelemetryCli(process.argv.slice(3));
} else if (command === 'serve-http') {
  await startStackarrMcpHttpServer();
} else {
  throw new Error(
    'Usage: stackarr mcp serve | stackarr mcp serve-http | stackarr mcp config <client> [--profile PROFILE] [--groups GROUPS] | stackarr mcp routines run-due | stackarr telemetry status|preview|enable|disable|send'
  );
}

async function runTelemetryCli(args: string[]) {
  const subcommand = args.shift() ?? 'status';

  switch (subcommand) {
    case 'status': {
      const { payloadPreview: _, ...status } = getTelemetryStatusAction();
      printJson(status);
      return;
    }
    case 'preview':
      printJson(previewTelemetryPayloadAction());
      return;
    case 'enable': {
      if (!args.includes('--yes')) {
        throw new Error('Pass --yes after reviewing `stackarr telemetry preview` to enable telemetry.');
      }

      const result = updateTelemetryConfigAction({
        enabled: true,
        endpoint: valueAfter(args, '--endpoint'),
        channel: valueAfter(args, '--channel'),
        confirmTelemetry: true
      });
      printJson(result);
      return;
    }
    case 'disable':
      printJson(updateTelemetryConfigAction({ enabled: false }));
      return;
    case 'send':
      printJson(
        await sendTelemetryAction({
          dryRun: !args.includes('--yes'),
          force: args.includes('--force')
        })
      );
      return;
    default:
      throw new Error(`Unknown telemetry command: ${subcommand}`);
  }
}

function valueAfter(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
