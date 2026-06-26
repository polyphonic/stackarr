#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

MODE="${1:-audit}"
[[ "$MODE" == "audit" || "$MODE" == "fix" ]] || fail "Usage: permissions.sh audit|fix"

load_env
print_header "Stackarr Permissions ${MODE^}"

TARGETS=(
    "$MEDIA_ROOT"
    "$MUSIC_ROOT"
    "$CONFIG_ROOT"
    "$STATE_ROOT"
    "$LOG_ROOT"
    "$DOWNLOADS_ROOT"
    "$BACKUP_ROOT"
)

if [[ -n "${PLEX_CONFIG_PATH:-}" ]]; then
    TARGETS+=("$PLEX_CONFIG_PATH")
fi

SEEN=""
FAILS=0
FIXED=0

if [[ "$MODE" == "fix" ]]; then
    warn "Fix mode will run recursive chown on mismatched roots"
    confirm "Continue with fix mode" no || exit 1
fi

for path in "${TARGETS[@]}"; do
    [[ -d "$path" ]] || { warn "Missing directory: $path"; continue; }
    real="$(canonical_dir "$path" || true)"
    [[ -n "$real" ]] || continue
    if printf '%s
' "$SEEN" | grep -Fxq "$real"; then
        continue
    fi
    SEEN="$SEEN
$real"

    uid="$(stat -f '%u' "$real")"
    gid="$(stat -f '%g' "$real")"
    if [[ "$uid" == "$PUID" && "$gid" == "$PGID" ]]; then
        ok "$real owned by $PUID:$PGID"
        continue
    fi

    FAILS=$((FAILS + 1))
    warn "$real owned by $uid:$gid (expected $PUID:$PGID)"

    if [[ "$MODE" == "fix" ]]; then
        echo "Running: sudo chown -R $PUID:$PGID $real"
        sudo chown -R "$PUID:$PGID" "$real"
        ok "$real ownership fixed"
        FIXED=$((FIXED + 1))
    fi
done

echo ""
if [[ "$MODE" == "audit" ]]; then
    echo "Issues found: $FAILS"
else
    echo "Issues found: $FAILS"
    echo "Issues fixed: $FIXED"
fi
