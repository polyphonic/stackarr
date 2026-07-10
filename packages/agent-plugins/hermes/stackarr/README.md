# Stackarr for Hermes

Stackarr connects through Hermes' native MCP client. This preserves the individual tool schemas, risk annotations, service-aware catalog, and in-chat elicitation prompts. There is no generic wrapper tool.

## Install

```bash
stackarr plugins install hermes
```

That registers `stackarr mcp serve` under `mcp_servers.stackarr` with the default `manage` profile.

Choose a different authority profile during installation:

```bash
stackarr plugins install hermes --profile observe
stackarr plugins install hermes --profile admin
stackarr plugins install hermes --profile unrestricted
```

For a manual install:

```bash
hermes mcp add stackarr \
  --command stackarr \
  --env STACKARR_MCP_PROFILE=manage \
  --args mcp serve
```

Restart Hermes or `/reset` after installation.

## Why Native MCP

Hermes supports MCP elicitation on its CLI, TUI, and messaging surfaces. Using that client directly means destructive Stackarr actions pause for the real Hermes approval UI, while `unrestricted` remains an explicit user-controlled opt-in.
