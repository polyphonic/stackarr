import { getMcpProfileDescription, resolveMcpProfile } from './controlPlane';
import type { McpProfile, ToolCategory } from './types';

export const mcpClientIds = ['codex', 'claude', 'lmstudio', 'chatgpt', 'hermes', 'openclaw', 'generic'] as const;

export type McpClientId = (typeof mcpClientIds)[number];

export type McpConnectionKit = {
  client: McpClientId;
  label: string;
  transport: 'docker-stdio' | 'openai-secure-tunnel';
  profile: McpProfile;
  profileDescription: string;
  groups: ToolCategory[] | 'all-relevant';
  summary: string;
  command?: string;
  config?: Record<string, unknown>;
  steps: string[];
  warnings: string[];
  verificationPrompt: string;
  documentationUrl?: string;
};

type ConnectionKitOptions = {
  client: McpClientId;
  profile?: McpProfile;
  groups?: ToolCategory[];
  containerName?: string;
  tunnelId?: string;
};

const clientLabels: Record<McpClientId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  lmstudio: 'LM Studio',
  chatgpt: 'ChatGPT',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  generic: 'Other MCP client'
};

const localClientSteps: Record<Exclude<McpClientId, 'chatgpt'>, string[]> = {
  codex: ['Run the generated command on the Docker host.', 'Start a new Codex task and ask it to inspect Stackarr.'],
  claude: [
    "Add the generated server entry to Claude's MCP configuration on the Docker host.",
    'Restart Claude, then start a new conversation.'
  ],
  lmstudio: [
    'In LM Studio, open Program → Install → Edit mcp.json.',
    'Add the generated Stackarr server entry, save, and enable it for the chat.'
  ],
  hermes: [
    'Run the generated Hermes command on the Docker host.',
    'Restart Hermes or start a new session so it reloads the tool catalog.'
  ],
  openclaw: [
    'Import the generated mcpServers entry into OpenClaw on the Docker host.',
    'Restart or reconnect OpenClaw so it reloads the tool catalog.'
  ],
  generic: [
    'Add the generated mcpServers entry to the MCP client running on the Docker host.',
    'Reconnect the client so it discovers Stackarr actions.'
  ]
};

export function isMcpClientId(value: string): value is McpClientId {
  return (mcpClientIds as readonly string[]).includes(value);
}

export function getMcpConnectionKit(options: ConnectionKitOptions): McpConnectionKit {
  const profile = options.profile ?? resolveMcpProfile();
  const groups = uniqueGroups(options.groups);
  const containerName = normalizeContainerName(options.containerName);
  const dockerArgs = dockerMcpArgs(profile, groups, containerName, options.client);
  const dockerCommand = shellJoin(['docker', ...dockerArgs]);
  const base = {
    client: options.client,
    label: clientLabels[options.client],
    profile,
    profileDescription: getMcpProfileDescription(profile),
    groups: groups.length > 0 ? groups : ('all-relevant' as const),
    verificationPrompt:
      'Inspect my Stackarr control plane, tell me which apps and actions are available, and do not make changes yet.'
  };

  if (options.client === 'chatgpt') {
    const tunnelId = normalizeTunnelId(options.tunnelId);
    const tunnelProfile = 'stackarr';
    return {
      ...base,
      transport: 'openai-secure-tunnel',
      summary: 'Connect ChatGPT without opening an inbound homelab port or publishing the Stackarr MCP server.',
      command: [
        'export CONTROL_PLANE_API_KEY="your-runtime-api-key"',
        shellJoin([
          'tunnel-client',
          'init',
          '--sample',
          'sample_mcp_stdio_local',
          '--profile',
          tunnelProfile,
          '--tunnel-id',
          tunnelId,
          '--mcp-command',
          dockerCommand
        ]),
        `tunnel-client doctor --profile ${tunnelProfile} --explain`,
        `tunnel-client run --profile ${tunnelProfile}`
      ].join('\n'),
      steps: [
        'Create a tunnel in OpenAI Platform tunnel settings and associate it with the intended ChatGPT workspace.',
        'Install the latest OpenAI tunnel-client on the Docker host and set its runtime API key locally.',
        'Run the generated commands and keep tunnel-client healthy.',
        'In ChatGPT, enable developer mode, create a plugin, choose Tunnel, and select the Stackarr tunnel.'
      ],
      warnings: profileWarnings(profile, [
        'The runtime API key stays on the Docker host. Never paste it into Stackarr, chat, or an MCP tool call.',
        'OpenAI tunnel and ChatGPT developer-mode availability depends on the account and workspace permissions.'
      ]),
      documentationUrl: 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels'
    };
  }

  const config = {
    mcpServers: {
      stackarr: {
        command: 'docker',
        args: dockerArgs
      }
    }
  };
  const command = localClientCommand(options.client, dockerCommand, profile, groups, containerName);
  const warnings = profileWarnings(
    profile,
    options.client === 'lmstudio'
      ? [
          "Local models can struggle with large tool catalogs. Keep Stackarr's automatic service filtering enabled and add groups only when you need a smaller catalog.",
          'If LM Studio does not declare form elicitation, destructive actions fail closed. Use observe for read-only access or deliberately choose unrestricted for autonomous changes.'
        ]
      : []
  );

  return {
    ...base,
    transport: 'docker-stdio',
    summary: `Connect ${clientLabels[options.client]} directly to the private Stackarr container on the Docker host.`,
    command,
    config,
    steps: localClientSteps[options.client],
    warnings,
    documentationUrl:
      options.client === 'lmstudio' ? 'https://lmstudio.ai/docs/app/mcp' : 'https://stackarr.app/docs/agent/mcp'
  };
}

export function getMcpConnectionKits(options: Omit<ConnectionKitOptions, 'client'> = {}): McpConnectionKit[] {
  return mcpClientIds.map((client) => getMcpConnectionKit({ ...options, client }));
}

function dockerMcpArgs(profile: McpProfile, groups: ToolCategory[], containerName: string, client: McpClientId) {
  const args = ['exec', '-i', '-e', `STACKARR_MCP_PROFILE=${profile}`, '-e', `STACKARR_MCP_CLIENT=${client}`];
  if (groups.length > 0) {
    args.push('-e', `STACKARR_MCP_GROUPS=${groups.join(',')}`);
  }
  args.push(containerName, '/app/bin/stackarr', 'mcp', 'serve');
  return args;
}

function localClientCommand(
  client: Exclude<McpClientId, 'chatgpt'>,
  dockerCommand: string,
  profile: McpProfile,
  groups: ToolCategory[],
  containerName: string
) {
  if (client === 'codex') return `codex mcp add stackarr -- ${dockerCommand}`;
  if (client === 'hermes') {
    const args = [
      'hermes',
      'mcp',
      'add',
      'stackarr',
      '--command',
      'docker',
      '--args',
      'exec',
      '-i',
      '-e',
      `STACKARR_MCP_PROFILE=${profile}`,
      '-e',
      `STACKARR_MCP_CLIENT=${client}`
    ];
    if (groups.length > 0) args.push('-e', `STACKARR_MCP_GROUPS=${groups.join(',')}`);
    args.push(containerName, '/app/bin/stackarr', 'mcp', 'serve');
    return shellJoin(args);
  }
  return undefined;
}

function profileWarnings(profile: McpProfile, warnings: string[]) {
  if (profile === 'unrestricted') {
    return [
      'Unrestricted gives the agent complete control and skips Stackarr per-action approval prompts. Only install this configuration intentionally.',
      ...warnings
    ];
  }
  if (profile === 'manage' || profile === 'admin') {
    return [
      'Destructive actions require MCP form elicitation. Clients without it can still use safe actions, but destructive calls fail closed.',
      ...warnings
    ];
  }
  return warnings;
}

function uniqueGroups(groups: ToolCategory[] | undefined) {
  return [...new Set(groups ?? [])];
}

function normalizeContainerName(value: string | undefined) {
  const candidate = value?.trim() || process.env.STACKARR_CONTAINER_NAME?.trim() || 'app';
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(candidate) ? candidate : 'app';
}

function normalizeTunnelId(value: string | undefined) {
  const candidate = value?.trim();
  return candidate && /^tunnel_[a-zA-Z0-9_-]+$/.test(candidate) ? candidate : 'tunnel_your_tunnel_id';
}

function shellJoin(values: string[]) {
  return values.map(shellQuote).join(' ');
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
