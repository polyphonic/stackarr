# Stackarr MCP control plane

Stackarr exposes a local stdio MCP server for chat agents that manage a homelab through typed Stackarr actions and the native APIs of the installed apps. It does not expose a generic shell, `curl`, or Docker exec tool.

## Authority profiles

Set `STACKARR_MCP_PROFILE` in the MCP server launch environment. The agent cannot change its own profile.

| Profile | Exposed actions | Destructive actions |
| --- | --- | --- |
| `observe` | Read-only status, diagnostics, queues, libraries, and requests | Not exposed |
| `manage` | `observe` plus native media, request, download, backup, and safe-repair actions | In-chat approval required |
| `admin` | Complete Stackarr setup, configuration, Docker, network, migration, restore, and app catalog | In-chat approval required |
| `unrestricted` | Same complete catalog as `admin` | Runs without per-action approval |

`manage` is the default. `unrestricted` is for a user who deliberately wants the agent to operate autonomously; enable it only in the MCP launch configuration.

## Tool routing and installed apps

MCP advertises a flat tool list, so Stackarr groups tools with category metadata and prunes the list before it reaches the model:

- Plex tools appear only when Plex is enabled.
- Seerr request tools appear only when Seerr is enabled.
- Sonarr and Radarr tools follow the enabled TV/movie instances.
- Downloader tools follow Transmission or qBittorrent.
- Streamrip/Lidarr tools require their corresponding services.
- Prowlarr release tools appear only when Prowlarr is enabled.

The `manage` profile also omits control-plane configuration and raw Docker-resource actions. Call `stackarr_get_mcp_control_plane` to see the active profile, approval mode, enabled services, and grouped tools. Restart the MCP connection after enabling or disabling apps so the client receives a fresh catalog.

For small local models, optionally select only the action families needed in that client:

```bash
STACKARR_MCP_GROUPS=stack,services,arr,downloads,seerr,health
```

Available groups are `stack`, `services`, `containers`, `arr`, `releases`, `downloads`, `plex`, `seerr`, `backups`, and `health`. This is an additional launch-time allowlist; the agent cannot add groups during a session.

## In-chat approval

Dangerous calls use MCP form elicitation. The client pauses the tool call and presents the exact redacted tool name and arguments to the user. Stackarr executes only when the client returns an explicit acceptance with the approval control enabled.

If a client does not declare MCP elicitation support, the action fails closed and explains the available choices. Non-destructive `manage` actions continue to work. A user can move that client to `unrestricted` if they intentionally want complete autonomous control.

Credentials are not requested through MCP elicitation. Account passwords, API keys, and tokens must be entered through an authenticated settings or downstream-app surface. Endpoint, bind-address, and image changes can be authorized through the chat approval prompt.

## Local install

Packaged installs use the stable CLI boundary:

```bash
stackarr mcp serve
```

### Codex

```bash
codex mcp add stackarr \
  --env STACKARR_MCP_PROFILE=manage \
  -- stackarr mcp serve
```

Use `admin` for agent-led setup or complete homelab administration. Codex surfaces MCP elicitation as an approval request inside the active task.

### Hermes

```bash
stackarr plugins install hermes --profile manage
```

Stackarr registers as a native Hermes MCP server, rather than wrapping all actions in one generic plugin tool. This preserves per-tool schemas, filtering, annotations, audit records, and Hermes' CLI/TUI/messaging approval flow.

### OpenClaw

```bash
stackarr plugins install openclaw --profile manage
```

Import the generated `mcp.json`. OpenClaw receives the same shared MCP server and tool policy. If the installed OpenClaw client does not support MCP elicitation, dangerous actions fail closed unless the user selects `unrestricted`.

### LM Studio

LM Studio uses Cursor-style `mcp.json` configuration. In **Program > Install > Edit mcp.json**, add:

```json
{
  "mcpServers": {
    "stackarr": {
      "command": "stackarr",
      "args": ["mcp", "serve"],
      "env": {
        "STACKARR_MCP_PROFILE": "manage",
        "STACKARR_MCP_GROUPS": "stack,services,arr,downloads,seerr,health"
      }
    }
  }
}
```

LM Studio warns that large MCP catalogs can consume local-model context. Stackarr's profile and service filtering are intended to keep this surface useful for smaller local models. LM Studio also supports its own `allowed_tools` restriction for API-driven MCP use.

## Docker install

The MCP host runs on the user's computer, while Stackarr runs in its container. Configure the host to execute the stdio server with `docker exec -i`; do not install Codex, Hermes, or LM Studio inside the Stackarr container.

For a standalone container named `stackarr`:

```bash
codex mcp add stackarr -- \
  docker exec -i \
    -e STACKARR_MCP_PROFILE=manage \
    stackarr /app/bin/stackarr mcp serve
```

Equivalent `mcp.json` entry:

```json
{
  "mcpServers": {
    "stackarr": {
      "command": "docker",
      "args": [
        "exec", "-i",
        "-e", "STACKARR_MCP_PROFILE=manage",
        "stackarr", "/app/bin/stackarr", "mcp", "serve"
      ]
    }
  }
}
```

The managed Compose service is named `app`; replace `stackarr` with `app` in the command. Keep `-i` so MCP stdio remains connected. The Stackarr image already contains the compiled MCP server.

## Setup flow

1. Launch the MCP server with the `admin` profile.
2. Call `stackarr_get_setup_profile`.
3. Call `stackarr_setup_media_server` with `dryRun: true` and review the plan.
4. Call the same tool with `dryRun: false`.
5. Approve the elicitation prompt in the chat client.
6. Verify with system status, tasks, and service health tools.
7. Move back to `manage` if ongoing administration does not need setup, network, or Docker control-plane actions.

## Security properties

- stdio transport is local only; do not publish it through an HTTP bridge or tunnel.
- Profiles and installed-service state filter the catalog before `tools/list`.
- MCP annotations identify read-only and destructive tools to capable hosts.
- Destructive actions use client-mediated elicitation unless the launch profile is `unrestricted`.
- Configuration endpoints, bind addresses, and image references are treated as trust-boundary changes.
- Credentials are redacted from summaries and are not accepted by general MCP configuration actions.
- Every MCP call and decision is written to the Stackarr agent activity audit trail.

## Development

```bash
pnpm install
pnpm --filter @stackarr/mcp build
STACKARR_MCP_PROFILE=manage node packages/mcp/dist/index.js
```
