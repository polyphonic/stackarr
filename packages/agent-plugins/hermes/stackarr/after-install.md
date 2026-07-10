# Stackarr MCP configured

Connect Hermes from the Docker host:

```bash
docker exec app /app/bin/stackarr mcp config hermes --profile manage
```

Run the generated command, then restart Hermes or start a new session. Destructive actions use the client approval flow when it supports MCP form elicitation.
