# Manage Stackarr from chat

Stackarr exposes a local stdio MCP server from inside its Docker container. The server provides typed actions for Stackarr and enabled apps; it does not provide a generic shell or Docker exec tool.

## Authority profiles

| Profile | Use |
| --- | --- |
| `observe` | Read-only status and diagnostics |
| `manage` | Everyday requests, downloads, backups, and safe repairs |
| `admin` | Setup, configuration, networking, migrations, and restores |
| `unrestricted` | Complete control without per-action approval prompts |

Agents cannot change their own profile.

## Codex

```bash
codex mcp add stackarr -- \
  docker exec -i \
    -e STACKARR_MCP_PROFILE=manage \
    app /app/bin/stackarr mcp serve
```

## Other MCP clients

```json
{
  "mcpServers": {
    "stackarr": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "-e",
        "STACKARR_MCP_PROFILE=manage",
        "app",
        "/app/bin/stackarr",
        "mcp",
        "serve"
      ]
    }
  }
}
```

Before onboarding, Stackarr advertises a focused setup catalog. After setup, reconnect the client to load actions only for the selected apps. `STACKARR_MCP_GROUPS` can narrow the catalog further.

With `manage` or `admin`, destructive actions use the chat client's MCP approval prompt and fail closed when the client cannot display it. Use `unrestricted` only when complete autonomous control is intentional.

See the full guides for [MCP connections](https://stackarr.app/docs/agent/mcp), [Hermes and OpenClaw](https://stackarr.app/docs/agent/plugins), and [safety](https://stackarr.app/docs/agent/safety).
