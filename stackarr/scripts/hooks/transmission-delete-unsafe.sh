#!/bin/sh
set -eu

log() {
    printf 'transmission-delete-unsafe: %s\n' "$*" >&2
}

is_unsafe_name() {
    case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
        *.exe|*.exe.part|*.scr|*.scr.part|*.bat|*.bat.part|*.cmd|*.cmd.part|*.msi|*.msi.part|*.js|*.js.part|*.jse|*.jse.part|*.vbs|*.vbs.part|*.vbe|*.vbe.part|*.wsf|*.wsf.part|*.ps1|*.ps1.part|*.com|*.com.part|*.pif|*.pif.part|*.lnk|*.lnk.part|*.apk|*.apk.part|*.dmg|*.dmg.part|*.pkg|*.pkg.part)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_unsafe_torrent_name() {
    case "$1" in
        *\\*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

remove_torrent_if_possible() {
    [ -n "${torrent_id:-}" ] || return 0
    command -v transmission-remote >/dev/null 2>&1 || return 0
    [ -n "${USER:-}" ] || return 0
    [ -n "${PASS:-}" ] || return 0

    transmission-remote 127.0.0.1:9091 --auth "$USER:$PASS" --torrent "$torrent_id" --remove >/dev/null 2>&1 || true
}

route_torrent_if_possible() {
    [ -n "${torrent_id:-}" ] || return 0
    command -v curl >/dev/null 2>&1 || return 0
    command -v jq >/dev/null 2>&1 || return 0
    command -v transmission-remote >/dev/null 2>&1 || return 0
    [ -n "${USER:-}" ] || return 0
    [ -n "${PASS:-}" ] || return 0

    downloads_root="${STACKARR_DOWNLOADS_ROOT:-/downloads}"
    rpc_url="${STACKARR_TRANSMISSION_RPC_URL:-http://127.0.0.1:9091/transmission/rpc}"
    session_id="$(curl -sS -D - -o /dev/null -u "$USER:$PASS" "$rpc_url" \
        | tr -d '\r' \
        | awk '/X-Transmission-Session-Id/ {print $2}')"

    [ -n "$session_id" ] || return 0

    torrent_json="$(curl -fsS -u "$USER:$PASS" \
        -H "X-Transmission-Session-Id: $session_id" \
        -H 'Content-Type: application/json' \
        --data-binary "{\"method\":\"torrent-get\",\"arguments\":{\"ids\":[$torrent_id],\"fields\":[\"id\",\"percentDone\",\"labels\",\"downloadDir\"]}}" \
        "$rpc_url")" || return 0

    found_id="$(printf '%s' "$torrent_json" | jq -r '.arguments.torrents[0].id // empty')"
    [ -n "$found_id" ] || return 0

    is_complete="$(printf '%s' "$torrent_json" | jq -r '(.arguments.torrents[0].percentDone // 0) >= 1')"
    current_dir="$(printf '%s' "$torrent_json" | jq -r '.arguments.torrents[0].downloadDir // empty')"
    label="$(printf '%s' "$torrent_json" | jq -r '.arguments.torrents[0].labels[0] // empty')"

    case "$label" in
        ''|*[!A-Za-z0-9._-]*) label="" ;;
    esac

    if [ "$is_complete" = true ]; then
        target_dir="${TRANSMISSION_DOWNLOAD_DIR:-$downloads_root/complete}"
    else
        target_dir="${TRANSMISSION_INCOMPLETE_DIR:-$downloads_root/incomplete}"
    fi

    [ -z "$label" ] || target_dir="$target_dir/$label"
    [ "$current_dir" = "$target_dir" ] && return 0

    mkdir -p "$target_dir"
    if transmission-remote 127.0.0.1:9091 --auth "$USER:$PASS" \
        --torrent "$torrent_id" --move "$target_dir" >/dev/null 2>&1; then
        log "moved torrent $torrent_id from $current_dir to $target_dir"
    else
        log "failed to move torrent $torrent_id from $current_dir to $target_dir"
        return 1
    fi
}

delete_if_unsafe() {
    path="$1"
    [ -f "$path" ] || return 0

    if is_unsafe_name "$path"; then
        rm -f "$path"
        log "deleted unsafe payload: $path"
        unsafe_found=true
    fi
}

target_dir="${TR_TORRENT_DIR:-}"
target_name="${TR_TORRENT_NAME:-}"
torrent_id="${TR_TORRENT_ID:-}"
unsafe_found=false

[ -n "$target_dir" ] || exit 0
[ -n "$target_name" ] || exit 0

if is_unsafe_torrent_name "$target_name"; then
    log "removed unsafe torrent name: $target_name"
    remove_torrent_if_possible
    exit 1
fi

target_path="$target_dir/$target_name"

if [ -f "$target_path" ]; then
    delete_if_unsafe "$target_path"
elif [ -d "$target_path" ]; then
    find "$target_path" -type f | while IFS= read -r path; do
        if is_unsafe_name "$path"; then
            rm -f "$path"
            log "deleted unsafe payload: $path"
            printf '%s\n' unsafe > "$target_path/.stackarr-unsafe-deleted"
        fi
    done
    if [ -f "$target_path/.stackarr-unsafe-deleted" ]; then
        unsafe_found=true
        rm -f "$target_path/.stackarr-unsafe-deleted"
        find "$target_path" -depth -type d -empty -delete 2>/dev/null || true
    fi
fi

if [ "$unsafe_found" = true ]; then
    remove_torrent_if_possible
    exit 1
fi

route_torrent_if_possible
