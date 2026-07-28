#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ensureAgregarrCollectionPresetAction,
  getAgregarrCollectionAction,
  getAgregarrHomeOrderAction,
  getAgregarrOverviewAction,
  getMcpConnectionKit,
  getTelemetryStatusAction,
  isMcpClientId,
  type McpProfile,
  previewTelemetryPayloadAction,
  resolveMcpGroups,
  runAgregarrJobAction,
  runDueRoutinesAction,
  sendTelemetryAction,
  syncAgregarrCollectionAction,
  syncAgregarrCollectionGroupAction,
  type ToolCategory,
  updateAgregarrCollectionGroupAction,
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
} else if (command === 'agregarr') {
  await runAgregarrCli(process.argv.slice(3));
} else if (command === 'serve-http') {
  await startStackarrMcpHttpServer();
} else {
  throw new Error(
    'Usage: stackarr mcp serve | stackarr mcp serve-http | stackarr mcp config <client> [--profile PROFILE] [--groups GROUPS] | stackarr mcp routines run-due | stackarr telemetry status|preview|enable|disable|send | stackarr agregarr overview|collection|home-order|sync|sync-group|ensure-preset|update-group|job'
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

async function runAgregarrCli(args: string[]) {
  const subcommand = args.shift() ?? 'overview';
  const parsed = parseCommandArguments(args);

  switch (subcommand) {
    case 'overview':
      assertArguments(parsed, 0, []);
      printJson(await getAgregarrOverviewAction());
      return;
    case 'collection':
      assertArguments(parsed, 1, []);
      printJson(await getAgregarrCollectionAction({ collectionId: collectionId(parsed.positionals[0]) }));
      return;
    case 'home-order':
      assertArguments(parsed, 0, []);
      printJson(await getAgregarrHomeOrderAction());
      return;
    case 'sync':
      assertArguments(parsed, 1, []);
      printJson(await syncAgregarrCollectionAction({ collectionId: collectionId(parsed.positionals[0]) }));
      return;
    case 'sync-group':
      assertArguments(parsed, { minimum: 1, maximum: 20 }, []);
      printJson(await syncAgregarrCollectionGroupAction({ collectionIds: parsed.positionals.map(collectionId) }));
      return;
    case 'ensure-preset': {
      assertArguments(parsed, 1, ['media-scope', 'max-items', 'days-ahead']);
      printJson(
        await ensureAgregarrCollectionPresetAction({
          preset: agregarrPreset(parsed.positionals[0]),
          mediaScope: optionalMediaScope(parsed.options.get('media-scope')),
          maxItems: optionalInteger(parsed.options.get('max-items'), 'max-items'),
          daysAhead: optionalInteger(parsed.options.get('days-ahead'), 'days-ahead')
        })
      );
      return;
    }
    case 'update-group': {
      assertArguments(parsed, { minimum: 1, maximum: 20 }, [
        'active',
        'show-on-home',
        'recommended',
        'randomize-home-order'
      ]);
      if (parsed.options.size === 0) {
        throw new Error('update-group requires at least one setting option.');
      }
      printJson(
        await updateAgregarrCollectionGroupAction({
          collectionIds: parsed.positionals.map(collectionId),
          active: optionalBoolean(parsed.options.get('active'), 'active'),
          showOnHome: optionalBoolean(parsed.options.get('show-on-home'), 'show-on-home'),
          recommended: optionalBoolean(parsed.options.get('recommended'), 'recommended'),
          randomizeHomeOrder: optionalBoolean(parsed.options.get('randomize-home-order'), 'randomize-home-order')
        })
      );
      return;
    }
    case 'job':
      assertArguments(parsed, 1, []);
      printJson(await runAgregarrJobAction({ job: agregarrJob(parsed.positionals[0]) }));
      return;
    default:
      throw new Error(`Unknown Agregarr command: ${subcommand}. ${agregarrCliUsage}`);
  }
}

const agregarrCliUsage =
  'Usage: stackarr agregarr overview|collection <id>|home-order|sync <id>|sync-group <id...>|ensure-preset <coming-soon|tmdb-trending|imdb-popular> [--media-scope movie|tv|both] [--max-items N] [--days-ahead N]|update-group <id...> [--active true|false] [--show-on-home true|false] [--recommended true|false] [--randomize-home-order true|false]|job <full-sync|quick-sync|randomize-home-order>';

type ParsedCommandArguments = {
  positionals: string[];
  options: Map<string, string>;
};

function parseCommandArguments(args: string[]): ParsedCommandArguments {
  const positionals: string[] = [];
  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }

    const name = value.slice(2);
    const optionValue = args[index + 1];
    if (!name || !optionValue || optionValue.startsWith('--')) {
      throw new Error(`Missing value for ${value}.`);
    }
    if (options.has(name)) throw new Error(`Duplicate option: ${value}.`);
    options.set(name, optionValue);
    index += 1;
  }

  return { positionals, options };
}

function assertArguments(
  parsed: ParsedCommandArguments,
  positionalCount: number | { minimum: number; maximum: number },
  allowedOptions: string[]
) {
  const validPositionals =
    typeof positionalCount === 'number'
      ? parsed.positionals.length === positionalCount
      : parsed.positionals.length >= positionalCount.minimum && parsed.positionals.length <= positionalCount.maximum;
  if (!validPositionals) throw new Error(agregarrCliUsage);

  for (const option of parsed.options.keys()) {
    if (!allowedOptions.includes(option)) throw new Error(`Unknown option: --${option}. ${agregarrCliUsage}`);
  }
}

function collectionId(value: string | undefined) {
  if (!value || !/^\d{1,10}$/.test(value)) throw new Error('Collection IDs must contain 1 to 10 digits.');
  return value;
}

function agregarrPreset(value: string | undefined): 'coming-soon' | 'tmdb-trending' | 'imdb-popular' {
  if (value === 'coming-soon' || value === 'tmdb-trending' || value === 'imdb-popular') return value;
  throw new Error('Preset must be coming-soon, tmdb-trending, or imdb-popular.');
}

function agregarrJob(value: string | undefined): 'full-sync' | 'quick-sync' | 'randomize-home-order' {
  if (value === 'full-sync' || value === 'quick-sync' || value === 'randomize-home-order') return value;
  throw new Error('Job must be full-sync, quick-sync, or randomize-home-order.');
}

function optionalMediaScope(value: string | undefined): 'movie' | 'tv' | 'both' | undefined {
  if (value === undefined || value === 'movie' || value === 'tv' || value === 'both') return value;
  throw new Error('media-scope must be movie, tv, or both.');
}

function optionalBoolean(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function optionalInteger(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  return Number(value);
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
