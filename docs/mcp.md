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

## Generate a connection

Stackarr generates the correct host-side configuration for each supported client:

```bash
docker exec app /app/bin/stackarr mcp config codex --profile manage
docker exec app /app/bin/stackarr mcp config claude --profile manage
docker exec app /app/bin/stackarr mcp config lmstudio --profile observe
docker exec app /app/bin/stackarr mcp config hermes --profile manage
docker exec app /app/bin/stackarr mcp config openclaw --profile manage
```

Run the generated Codex or Hermes command, or import the generated `mcpServers` entry into Claude, LM Studio, OpenClaw, or another MCP client.

LM Studio users add the entry in **Program → Install → Edit mcp.json**. Stackarr's automatic app filtering and optional `--groups stack,services,arr,downloads,seerr,health` keep local-model context focused.

## ChatGPT

Use an outbound-only OpenAI Secure MCP Tunnel so Stackarr remains private:

```bash
docker exec app /app/bin/stackarr mcp config chatgpt \
  --profile manage \
  --tunnel-id tunnel_your_tunnel_id
```

Follow the generated steps to run `tunnel-client` on the Docker host, then select that tunnel when creating a ChatGPT developer-mode plugin. The runtime API key never belongs in Stackarr or chat.

Before onboarding, Stackarr advertises a focused setup catalog. After setup, reconnect the client to load actions only for the selected apps. `STACKARR_MCP_GROUPS` can narrow the catalog further.

With `manage` or `admin`, destructive actions use the chat client's MCP approval prompt and fail closed when the client cannot display it. Use `unrestricted` only when complete autonomous control is intentional.

An existing agent can call `stackarr_get_mcp_connection_kit` to help connect another chat surface. See the full guides for [MCP connections](https://stackarr.app/docs/agent/mcp), [Hermes and OpenClaw](https://stackarr.app/docs/agent/plugins), and [safety](https://stackarr.app/docs/agent/safety).
