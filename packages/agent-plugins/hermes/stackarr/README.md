# Stackarr for Hermes

Stackarr connects through Hermes' native MCP client from the Docker host. This preserves individual tool schemas, risk annotations, service-aware filtering, and in-chat elicitation prompts. There is no generic wrapper tool.

## Install

```bash
hermes mcp add stackarr \
  --command docker \
  --args exec -i -e STACKARR_MCP_PROFILE=manage app /app/bin/stackarr mcp serve
```

Generate this command for any authority profile from the running container:

```bash
docker exec app /app/bin/stackarr mcp config hermes --profile manage
```

Restart Hermes or `/reset` after installation.

## Why Native MCP

Hermes receives the same dynamically filtered catalog as every other client. Destructive Stackarr actions pause for the client approval flow when form elicitation is available, while `unrestricted` remains an explicit user-controlled opt-in.
