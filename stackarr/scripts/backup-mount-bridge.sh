#!/bin/bash
# Narrow host mount-table attestation for /Volumes backup roots. No backup data is read.
set -Eeuo pipefail
umask 077

bridge_root() {
    local path="$1" part
    [[ "$path" == /Volumes/* && "$path" != *$'\n'* && "$path" != *$'\r'* ]] || return 1
    [[ "$path" != */ && "$path" != *//* ]] || return 1
    IFS=/ read -r -a parts <<< "${path#/}"
    [[ ${#parts[@]} -ge 2 && "${parts[0]}" == Volumes && -n "${parts[1]}" ]] || return 1
    for part in "${parts[@]}"; do
        [[ -n "$part" && "$part" != . && "$part" != .. ]] || return 1
    done
}

bridge_dir() {
    printf '%s/backup-mount-bridge\n' "$1"
}

bridge_nonce() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 16
    else
        # The app container ships Node; fail rather than use a predictable nonce.
        node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex")+"\n")'
    fi
}

bridge_verify() {
    local state="$1" root="$2" dir nonce request response tmp now received_root status issued extra attempt
    bridge_root "$root" || { echo 'Noncanonical external backup root' >&2; return 1; }
    dir="$(bridge_dir "$state")"
    # Only the host installer creates the private directory. A root container
    # must not pre-create it with ownership that locks out the host agent.
    [[ -d "$dir" && -w "$dir" && ! -L "$dir" ]] || {
        echo 'Host mount responder is not installed or bridge state is inaccessible' >&2
        return 1
    }
    nonce="$(bridge_nonce)" || return 1
    [[ "$nonce" =~ ^[a-f0-9]{32}$ ]] || return 1
    request="$dir/$nonce.request"
    response="$dir/$nonce.response"
    tmp="$dir/$nonce.tmp.$$"
    now="$(date +%s)"
    printf '%s\n%s\n%s\n' "$nonce" "$root" "$now" > "$tmp"
    mv -n "$tmp" "$request" || { rm -f "$tmp"; return 1; }
    # An existing name is not ours; fail, rather than trusting its response.
    if [[ -e "$tmp" ]]; then rm -f "$tmp"; return 1; fi
    for ((attempt=0; attempt<50; attempt++)); do
        if [[ -f "$response" && ! -L "$response" ]]; then
            if { IFS= read -r received_nonce && IFS= read -r received_root && IFS= read -r status && IFS= read -r issued && ! IFS= read -r extra; } < "$response" &&
                [[ "$received_nonce" == "$nonce" && "$received_root" == "$root" && "$status" == mounted && "$issued" =~ ^[0-9]+$ ]] &&
                (( issued >= now && issued <= $(date +%s) && $(date +%s) - issued <= 12 )); then
                rm -f "$request" "$response"
                return 0
            fi
            break
        fi
        sleep 0.2
    done
    rm -f "$request" "$response" "$tmp"
    echo 'Host mount proof missing, stale, or mismatched; external backup denied' >&2
    return 1
}

bridge_respond() {
    local state="$1" authorized="$2" dir request name nonce root requested_at extra now volume status tmp count=0
    [[ "$(uname -s)" == Darwin ]] || { echo 'Host mount responder requires macOS' >&2; return 1; }
    bridge_root "$authorized" || { echo 'Invalid configured backup root' >&2; return 1; }
    dir="$(bridge_dir "$state")"
    [[ -d "$dir" && ! -L "$dir" ]] || return 0
    local suffix="${authorized#/Volumes/}"
    volume="/Volumes/${suffix%%/*}"
    shopt -s nullglob
    local requests=("$dir"/*.request)
    [[ ${#requests[@]} -gt 0 ]] || return 0
    # A single OS mount-table snapshot; never stat or list the external volume.
    local mounts
    mounts="$(/sbin/mount)" || return 1
    for request in "${requests[@]}"; do
        count=$((count + 1)); (( count <= 128 )) || break
        name="${request##*/}"; nonce="${name%.request}"
        [[ "$nonce" =~ ^[a-f0-9]{32}$ && ! -L "$request" ]] || continue
        now="$(date +%s)"
        local modified
        modified="$(stat -f %m "$request" 2>/dev/null)" || continue
        if (( now - modified > 20 )); then
            rm -f "$request" "$dir/$nonce.response"
            continue
        fi
        if ! { IFS= read -r incoming && IFS= read -r root && IFS= read -r requested_at && ! IFS= read -r extra; } < "$request"; then continue; fi
        [[ "$incoming" == "$nonce" && "$root" == "$authorized" && "$requested_at" =~ ^[0-9]+$ ]] || continue
        now="$(date +%s)"
        (( requested_at <= now && now - requested_at <= 12 )) || continue
        status=absent
        while IFS= read -r line; do
            # Match the exact mountpoint, not a sibling/prefix or a directory bind.
            case "$line" in
                *" on $volume ("*) status=mounted; break ;;
            esac
        done <<< "$mounts"
        tmp="$dir/$nonce.response.tmp.$$"
        printf '%s\n%s\n%s\n%s\n' "$nonce" "$root" "$status" "$now" > "$tmp"
        mv -f "$tmp" "$dir/$nonce.response"
    done
}

case "${1:-}" in
    verify) [[ $# == 3 ]] || exit 2; bridge_verify "$2" "$3" ;;
    respond) [[ $# == 3 ]] || exit 2; bridge_respond "$2" "$3" ;;
    *) echo 'Usage: backup-mount-bridge.sh verify|respond STATE_ROOT BACKUP_ROOT' >&2; exit 2 ;;
esac
