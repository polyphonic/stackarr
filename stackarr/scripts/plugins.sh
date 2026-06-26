#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ACTION="${1:-help}"
RUNTIME="${2:-all}"
TARGET=""
CONFIGURE=true

shift || true
if [[ "$ACTION" != "help" ]]; then
    shift || true
fi

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --target)
            TARGET="${2:-}"
            shift 2
            ;;
        --no-configure|--no-config)
            CONFIGURE=false
            shift
            ;;
        *)
            fail "Unknown plugin option: $1"
            ;;
    esac
done

load_env

usage() {
    cat <<EOF
Usage: stackarr plugins install|export [hermes|openclaw|all] [--target PATH] [--no-configure]

Installs or exports Stackarr local-agent integrations. Plugins talk to
Stackarr through the local MCP server via 'stackarr mcp serve'; they do not
wrap Docker or direct service APIs.
EOF
}

stackarr_command_path() {
    local bin
    bin="$(find_stackarr_bin || true)"
    if [[ -n "$bin" ]]; then
        printf '%s\n' "$bin"
    else
        printf '%s\n' "$REPO_ROOT/bin/stackarr"
    fi
}

write_command_json() {
    local destination="$1"
    local command_path
    command_path="$(stackarr_command_path)"
    mkdir -p "$destination"
    python3 - "$destination/stackarr-command.json" "$command_path" "$REPO_ROOT" <<'PY'
import json
import sys
from pathlib import Path
out, command, cwd = sys.argv[1:]
Path(out).write_text(json.dumps({
    "command": command,
    "args": ["mcp", "serve"],
    "cwd": cwd,
    "env": {"STACKARR_REPO_ROOT": cwd}
}, indent=2) + "\n")
PY
}

install_hermes() {
    local destination="${TARGET:-${HERMES_HOME:-$HOME/.hermes}/plugins/stackarr}"
    local source="$REPO_ROOT/packages/agent-plugins/hermes/stackarr"
    [[ -d "$source" ]] || fail "Hermes plugin source missing: $source"

    rm -rf "$destination"
    mkdir -p "$(dirname "$destination")"
    cp -R "$source" "$destination"
    rm -rf "$destination/__pycache__"
    write_command_json "$destination"

    if $CONFIGURE && command -v hermes >/dev/null 2>&1; then
        hermes plugins enable stackarr >/dev/null 2>&1 || warn "Hermes plugin copied, but 'hermes plugins enable stackarr' failed"
        hermes tools enable stackarr >/dev/null 2>&1 || true
        hermes config set platform_toolsets.cli '["hermes-cli", "stackarr"]' >/dev/null 2>&1 || true
        hermes config set platform_toolsets.telegram '["hermes-telegram", "stackarr"]' >/dev/null 2>&1 || true
        ok "Installed and enabled Hermes Stackarr plugin at $destination"
    else
        ok "Installed Hermes Stackarr plugin at $destination"
        warn "Enable it in Hermes with: hermes plugins enable stackarr"
    fi
}

install_openclaw() {
    local destination="${TARGET:-$APP_ROOT/agent-plugins/openclaw/stackarr}"
    local source="$REPO_ROOT/packages/agent-plugins/openclaw/stackarr"
    local command_path
    [[ -d "$source" ]] || fail "OpenClaw plugin source missing: $source"

    rm -rf "$destination"
    mkdir -p "$(dirname "$destination")"
    cp -R "$source" "$destination"
    command_path="$(stackarr_command_path)"
    python3 - "$destination/plugin.yaml" "$destination/mcp.json" "$command_path" "$REPO_ROOT" <<'PY'
import json
import sys
from pathlib import Path
plugin_path, mcp_path, command, cwd = sys.argv[1:]
plugin_path = Path(plugin_path)
mcp_path = Path(mcp_path)
plugin_path.write_text(f"""name: stackarr
version: 0.1.0
description: Stackarr local MCP integration for OpenClaw-compatible agents.
author: Stackarr
transport: mcp-stdio
mcp:
  command: {json.dumps(command)}
  args:
    - mcp
    - serve
  cwd: {json.dumps(cwd)}
  timeout: 120
  connect_timeout: 30
safety:
  local_only: true
  expose_publicly: false
  dangerous_actions_require_confirmation: true
""")
mcp_path.write_text(json.dumps({
    "mcpServers": {
        "stackarr": {
            "command": command,
            "args": ["mcp", "serve"],
            "cwd": cwd,
            "timeout": 120,
            "connect_timeout": 30,
            "sampling": {"enabled": False}
        }
    }
}, indent=2) + "\n")
PY
    ok "Prepared OpenClaw-compatible Stackarr plugin bundle at $destination"
    warn "Import $destination/mcp.json into OpenClaw or copy the bundle into OpenClaw's plugin directory."
}

case "$ACTION" in
    install|export)
        case "$RUNTIME" in
            hermes)
                install_hermes
                ;;
            openclaw)
                install_openclaw
                ;;
            all)
                base_target="$TARGET"
                if [[ -n "$base_target" ]]; then
                    TARGET="$base_target/hermes/stackarr"
                    install_hermes
                    TARGET="$base_target/openclaw/stackarr"
                    install_openclaw
                    TARGET="$base_target"
                else
                    install_hermes
                    install_openclaw
                fi
                ;;
            *)
                fail "Unknown plugin runtime: $RUNTIME"
                ;;
        esac
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac
