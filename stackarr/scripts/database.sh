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
        docker compose -f "$ROOT_DIR/docker-compose.yml" --profile database up -d database
        docker compose -f "$ROOT_DIR/docker-compose.yml" --profile database up --force-recreate database-init
        docker compose -f "$ROOT_DIR/docker-compose.yml" --profile database rm -f -s database-init >/dev/null 2>&1 || true
        ok "Shared database is initialized"
        ;;
    status)
        docker compose -f "$ROOT_DIR/docker-compose.yml" --profile database ps database database-init
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
