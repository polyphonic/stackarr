# Stackarr Hermes Plugin

Local Hermes plugin that exposes Stackarr's typed MCP server as native Hermes tools.

## Install

Preferred install from a packaged Stackarr app or CLI:

```bash
stackarr plugins install hermes
```

That copies the plugin to `~/.hermes/plugins/stackarr`, writes a local `stackarr-command.json` pointing at this Stackarr executable, and enables the plugin when the `hermes` CLI is available.

Manual/dev install is still possible:

```bash
cp -R packages/agent-plugins/hermes/stackarr ~/.hermes/plugins/stackarr
hermes plugins enable stackarr
```

For manual installs, either keep `stackarr` on `PATH`, write `~/.hermes/plugins/stackarr/stackarr-command.json`, or set `STACKARR_COMMAND`/`STACKARR_REPO_ROOT` so the plugin can run `stackarr mcp serve`.

Restart Hermes or `/reset` after enabling.

## Tools

- `stackarr_list_mcp_tools` — discover Stackarr MCP tools.
- `stackarr_mcp_call` — call any Stackarr MCP tool by name.
- `stackarr_get_status` — convenience wrapper for `stackarr_get_system_status`.
- `stackarr_get_setup_profile` — onboarding defaults/questions.
- `stackarr_setup_media_server` — onboarding execution; dry-run by default.

The plugin delegates to `stackarr mcp serve` and records activity through Stackarr's MCP audit layer.
