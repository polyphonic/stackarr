#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr database ensure
  stackarr database status
EOF
}

load_env
write_compose_env_file
ensure_docker_runtime

case "${1:-help}" in
    ensure)
        ensure_shared_database
        ok "Shared database is initialized"
        ;;
    status)
        stackarr_compose --profile database ps database
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
