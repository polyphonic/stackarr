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
