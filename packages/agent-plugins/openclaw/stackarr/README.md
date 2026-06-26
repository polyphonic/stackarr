# Stackarr OpenClaw Plugin

OpenClaw-compatible local MCP plugin bundle for Stackarr.

Because OpenClaw-style plugin layouts vary by runtime, this bundle includes both:

- `plugin.yaml` — manifest with stdio MCP transport metadata.
- `mcp.json` — drop-in MCP server config for clients that import MCP JSON.

Preferred setup from a packaged Stackarr app or CLI:

```bash
stackarr plugins install openclaw
```

That writes a bundle under Stackarr's app data and rewrites `plugin.yaml`/`mcp.json` to call this install through:

```bash
stackarr mcp serve
```

The committed files intentionally use the portable `stackarr` command instead of a developer checkout path. Packaged/onboarding installs rewrite them to the concrete executable path when possible.

The Stackarr MCP server is local stdio only and should not be exposed publicly.
Dangerous Stackarr actions require explicit confirmation fields such as
`confirmDangerous: true` and `reason`.
