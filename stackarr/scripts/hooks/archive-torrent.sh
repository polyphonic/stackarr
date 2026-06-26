#!/bin/sh
set -eu

log() {
    printf '%s\n' "$*" >&2
}

lower() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

upper() {
    printf '%s' "$1" | tr '[:lower:]' '[:upper:]'
}

sanitize_filename() {
    printf '%s' "$1" | tr '/' '_'
}

find_torrent_file() {
    base_dir="$1"
    hash="$2"

    [ -d "$base_dir" ] || return 1

    for candidate_hash in "$hash" "$(lower "$hash")" "$(upper "$hash")"; do
        candidate="$base_dir/$candidate_hash.torrent"
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    return 1
}

copy_into_archive() {
    media_path="$1"
    download_id="$2"
    archive_name="$3"

    case "$media_path" in
        /movies/*)
            relative_path="${media_path#/movies/}"
            archive_root="/torrent-archive/Movies"
            ;;
        /tv/*)
            relative_path="${media_path#/tv/}"
            archive_root="/torrent-archive/TV Shows"
            ;;
        *)
            log "archive-torrent: unsupported media path '$media_path'"
            return 0
            ;;
    esac

    parent_path="$(dirname "$relative_path")"
    if [ "$parent_path" = "." ]; then
        destination_dir="$archive_root"
    else
        destination_dir="$archive_root/$parent_path"
    fi

    source_torrent="$(
        find_torrent_file "/torrent-client-state/qbittorrent" "$download_id" ||
        find_torrent_file "/torrent-client-state/transmission" "$download_id" ||
        true
    )"

    if [ -z "$source_torrent" ]; then
        log "archive-torrent: no .torrent file found for download id '$download_id'"
        return 1
    fi

    mkdir -p "$destination_dir"
    destination_path="$destination_dir/$(sanitize_filename "$archive_name").torrent"
    cp -f "$source_torrent" "$destination_path"
    log "archive-torrent: copied $(basename "$source_torrent") to $destination_path"
}

event_type="${radarr_eventtype:-${sonarr_eventtype:-}}"

case "$event_type" in
    ""|Test|Grab|Rename|SeriesDeleted|EpisodeDeleted|MovieDeleted|MovieFileDelete|MovieFileDeleteForUpgrade|HealthIssue)
        exit 0
        ;;
esac

if [ -n "${radarr_moviefile_path:-}" ]; then
    download_id="${radarr_download_id:-}"
    [ -n "$download_id" ] || exit 0
    archive_name="${radarr_moviefile_scenename:-${radarr_release_title:-$(basename "${radarr_moviefile_path%.*}")}}"
    copy_into_archive "${radarr_moviefile_path}" "$download_id" "$archive_name"
    exit $?
fi

if [ -n "${sonarr_episodefile_path:-}" ]; then
    download_id="${sonarr_download_id:-}"
    [ -n "$download_id" ] || exit 0
    archive_name="${sonarr_episodefile_scenename:-${sonarr_release_title:-$(basename "${sonarr_episodefile_path%.*}")}}"
    copy_into_archive "${sonarr_episodefile_path}" "$download_id" "$archive_name"
    exit $?
fi

exit 0
