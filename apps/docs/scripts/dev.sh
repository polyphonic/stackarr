#!/usr/bin/env bash
set -Eeuo pipefail

DOCS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$DOCS_ROOT/docker-compose.yml"

docs_compose() {
    docker compose \
        --project-name stackarr-dev \
        --project-directory "$DOCS_ROOT" \
        -f "$COMPOSE_FILE" \
        "$@"
}

cleanup() {
    local status=$?
    trap - EXIT INT TERM HUP
    docs_compose down --remove-orphans || true
    exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

docs_compose up -d --wait

cd "$DOCS_ROOT"
pnpm exec next dev --webpack
