# Stackarr OpenClaw Plugin

OpenClaw-compatible local MCP plugin bundle for Stackarr.

Because OpenClaw-style plugin layouts vary by runtime, this bundle includes both:

- `plugin.yaml` — manifest with stdio MCP transport metadata.
- `mcp.json` — drop-in MCP server config for clients that import MCP JSON.

Generate a Docker-host configuration for the authority you want:

```bash
docker exec app /app/bin/stackarr mcp config openclaw --profile manage
```

Import the generated `mcpServers` entry into OpenClaw. The committed files use the same Docker stdio connection with the default `manage` profile.

The Stackarr MCP server stays local to the Docker host. Dangerous actions use MCP elicitation. Clients without elicitation support fail closed; users who deliberately want complete autonomous control can generate the connection with `--profile unrestricted`.
