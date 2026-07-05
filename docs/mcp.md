# Stackarr MCP

Stackarr includes a local-first MCP server for trusted personal agents such as Hermes or OpenClaw.

## Transport

V1 is local stdio only. Do not expose the MCP server directly to the public internet.

## Build

```bash
pnpm install
pnpm --filter @stackarr/mcp build
```

## Frontend default

Stackarr's frontend uses port `7777` by default so it behaves like a normal local arr-family app:

```bash
pnpm dev
```

Override with `STACKARR_WEB_PORT` when needed.

## Agent-driven first setup

Agents should start with `stackarr_get_setup_profile`. It returns the small set of user-facing questions and the opinionated defaults. In normal use, ask only for decisions that materially affect the install, especially:

- libraries to set up: `movies`, `tv`, `music`, `books`, `photos`, and/or `games`
- torrent client: `transmission` or `qbittorrent`
- media root
- downloads root
- optional local agent plugins: `hermes`, `openclaw`

Then call `stackarr_setup_media_server`.

The setup tool defaults to `dryRun: true`, returning the exact saved-configuration patch and command sequence. To execute the complete setup, call it with:

```json
{
  "dryRun": false,
  "confirmSetup": true,
  "torrentClient": "transmission"
}
```

Execution writes Stackarr config, downloads/starts the stack via `stackarr up`, runs `stackarr configure`, applies Plex-friendly naming/download/request presets, optionally enables automation, optionally installs selected agent plugins with `stackarr plugins install <runtime>`, and opens the browser at `http://127.0.0.1:7777`.

## Plugin configuration

For packaged installs, prefer the Stackarr executable as the stable MCP boundary:

```json
{
  "mcpServers": {
    "stackarr": {
      "command": "stackarr",
      "args": ["mcp", "serve"],
      "timeout": 120,
      "connect_timeout": 30,
      "sampling": { "enabled": false }
    }
  }
}
```

Stackarr can install/export concrete plugin bundles that point at the current executable:

```bash
stackarr plugins install hermes
stackarr plugins install openclaw
stackarr plugins export all --target /path/to/plugin-output
```

The committed plugin templates stay path-portable; the install/export command rewrites runtime manifests with the actual installed executable path where useful.

## Generic MCP configuration

```yaml
mcp_servers:
  stackarr:
    command: "stackarr"
    args: ["mcp", "serve"]
    timeout: 120
    connect_timeout: 30
    sampling:
      enabled: false
```

Development checkouts can also run the compiled MCP entrypoint directly after `pnpm --filter @stackarr/mcp build`, but published plugins should use `stackarr mcp serve` so they work from macOS apps, Windows executables, and Docker-backed installs.

## Safety model

- Tools are named typed Stackarr actions; there is no generic shell, curl, or Docker exec tool.
- Read-only tools cover system/service/Arr/Prowlarr/download/Plex/Seerr/backup/health inspection.
- Write tools use Stackarr action wrappers or service APIs when a safe adapter is implemented; otherwise they return `implemented: false` and make no service changes rather than pretending success.
- Dangerous tools require explicit structured confirmation such as `confirmDangerous: true` and `reason`.
- Download deletion requires `confirmDeleteData: true` when `deleteData` is set.
- Secrets are redacted from config summaries, activity logs, and MCP errors where possible.
- All MCP tool calls are recorded in `tmp/web-state/agent-activity.jsonl` and displayed in the dashboard Agent section.

## Plex and downtime

Plex V1 uses the Plex API directly; Tracearr is the optional managed monitoring service for richer media-server analytics. Avoid invoking stack stop/update/restart tools during live verification unless you intentionally want downtime.
