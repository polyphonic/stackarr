#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ACTION="${1:-help}"
RUNTIME="${2:-all}"
TARGET=""
CONFIGURE=true
MCP_PROFILE="${STACKARR_MCP_PROFILE:-manage}"
MCP_CONTAINER_NAME="${STACKARR_CONTAINER_NAME:-app}"
MCP_GROUPS="${STACKARR_MCP_GROUPS:-}"

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
        --profile)
            MCP_PROFILE="${2:-}"
            shift 2
            ;;
        --groups)
            MCP_GROUPS="${2:-}"
            shift 2
            ;;
        *)
            fail "Unknown plugin option: $1"
            ;;
    esac
done

case "$MCP_PROFILE" in
    observe|manage|admin|unrestricted) ;;
    *) fail "Unknown MCP profile: $MCP_PROFILE (expected observe, manage, admin, or unrestricted)" ;;
esac

if [[ -n "$MCP_GROUPS" ]]; then
    IFS=',' read -r -a requested_groups <<<"$MCP_GROUPS"
    for group in "${requested_groups[@]}"; do
        case "$group" in
            stack|services|apps|automations|connections|containers|arr|releases|downloads|plex|seerr|backups|health) ;;
            *) fail "Unknown MCP tool group: $group" ;;
        esac
    done
fi

load_env

usage() {
    cat <<EOF
Usage: stackarr plugins install|export [hermes|openclaw|all] [--target PATH] [--profile PROFILE] [--groups GROUPS] [--no-configure]

Installs or exports Stackarr local-agent integrations. Plugins talk to
Stackarr through the local MCP server via 'stackarr mcp serve'; they do not
wrap Docker or direct service APIs.

Profiles: observe, manage (default), admin, unrestricted.
EOF
}

stackarr_command_path() {
    install_managed_host_runtime
}

install_hermes() {
    local destination="${TARGET:-${HERMES_HOME:-$HOME/.hermes}/plugins/stackarr}"
    local source="$REPO_ROOT/packages/agent-plugins/hermes/stackarr"
    local command_path
    local docker_groups=""
    [[ -d "$source" ]] || fail "Hermes plugin source missing: $source"

    rm -rf "$destination"
    mkdir -p "$(dirname "$destination")"
    cp -R "$source" "$destination"
    rm -rf "$destination/__pycache__"
    command_path="$(stackarr_command_path)"

    if [[ "${STACKARR_RUNTIME:-}" == "docker" ]]; then
        if [[ -n "$MCP_GROUPS" ]]; then
            docker_groups=" -e STACKARR_MCP_GROUPS='$MCP_GROUPS'"
        fi
        ok "Prepared the Hermes Stackarr MCP integration at $destination"
        warn "Run on the Docker host: hermes mcp add stackarr --command docker --args exec -i -e STACKARR_MCP_PROFILE='$MCP_PROFILE' -e STACKARR_MCP_CLIENT=hermes$docker_groups '$MCP_CONTAINER_NAME' /app/bin/stackarr mcp serve"
    elif $CONFIGURE && command -v hermes >/dev/null 2>&1; then
        local hermes_env=("STACKARR_MCP_PROFILE=$MCP_PROFILE" "STACKARR_MCP_CLIENT=hermes")
        if [[ -n "$MCP_GROUPS" ]]; then
            hermes_env+=("STACKARR_MCP_GROUPS=$MCP_GROUPS")
        fi
        hermes plugins disable stackarr >/dev/null 2>&1 || true
        printf 'y\ny\n' | hermes mcp add stackarr \
            --command "$command_path" \
            --env "${hermes_env[@]}" \
            --args mcp serve >/dev/null
        ok "Configured Stackarr as a native Hermes MCP server with the '$MCP_PROFILE' profile"
    else
        ok "Prepared the Hermes Stackarr MCP integration at $destination"
        warn "Configure it with: hermes mcp add stackarr --command '$command_path' --env STACKARR_MCP_PROFILE='$MCP_PROFILE' STACKARR_MCP_CLIENT=hermes --args mcp serve"
    fi
}

install_openclaw() {
    local destination="${TARGET:-$APP_ROOT/agent-plugins/openclaw/stackarr}"
    local source="$REPO_ROOT/packages/agent-plugins/openclaw/stackarr"
    local command_path runtime_root
    [[ -d "$source" ]] || fail "OpenClaw plugin source missing: $source"

    rm -rf "$destination"
    mkdir -p "$(dirname "$destination")"
    cp -R "$source" "$destination"
    command_path="$(stackarr_command_path)"
    runtime_root="$(managed_host_runtime_root)"
    python3 - "$destination/plugin.yaml" "$destination/mcp.json" "$command_path" "$runtime_root" "$MCP_PROFILE" "${STACKARR_RUNTIME:-}" "$MCP_CONTAINER_NAME" "$MCP_GROUPS" <<'PY'
import json
import sys
from pathlib import Path
plugin_path, mcp_path, command, cwd, profile, runtime, container_name, groups = sys.argv[1:]
plugin_path = Path(plugin_path)
mcp_path = Path(mcp_path)
if runtime == "docker":
    command = "docker"
    args = [
        "exec", "-i", "-e", f"STACKARR_MCP_PROFILE={profile}", "-e", "STACKARR_MCP_CLIENT=openclaw"
    ]
    if groups:
        args.extend(["-e", f"STACKARR_MCP_GROUPS={groups}"])
    args.extend([container_name, "/app/bin/stackarr", "mcp", "serve"])
    cwd_value = None
    env = {}
else:
    args = ["mcp", "serve"]
    cwd_value = cwd
    env = {"STACKARR_REPO_ROOT": cwd, "STACKARR_MCP_PROFILE": profile, "STACKARR_MCP_CLIENT": "openclaw"}
    if groups:
        env["STACKARR_MCP_GROUPS"] = groups
yaml_args = "\n".join(f"    - {json.dumps(value)}" for value in args)
yaml_cwd = f"  cwd: {json.dumps(cwd_value)}\n" if cwd_value else ""
yaml_env = ""
if env:
    yaml_env = "  env:\n" + "\n".join(f"    {key}: {json.dumps(value)}" for key, value in env.items()) + "\n"
plugin_path.write_text(f"""name: stackarr
version: 0.1.0
description: Stackarr local MCP integration for OpenClaw-compatible agents.
author: Stackarr
transport: mcp-stdio
mcp:
  command: {json.dumps(command)}
  args:
{yaml_args}
{yaml_cwd}{yaml_env}  timeout: 120
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
            "args": args,
            **({"cwd": cwd_value} if cwd_value else {}),
            **({"env": env} if env else {}),
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
