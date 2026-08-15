#!/bin/sh
set -eu

TORRENT_ARCHIVE_ROOT="${TORRENT_ARCHIVE_ROOT:-/torrent-archive}"
QBITTORRENT_TORRENT_STATE_DIR="${QBITTORRENT_TORRENT_STATE_DIR:-/torrent-client-state/qbittorrent}"
TRANSMISSION_TORRENT_STATE_DIR="${TRANSMISSION_TORRENT_STATE_DIR:-/torrent-client-state/transmission}"

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

write_provenance_manifest() {
    destination_path="$1"
    manifest_path="${destination_path%.torrent}.provenance.json"
    temporary_path="$manifest_path.tmp.$$"

    if ! command -v jq >/dev/null 2>&1; then
        log "archive-torrent: jq is unavailable; the .torrent file was archived without a provenance manifest"
        return 0
    fi

    recorded_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    if [ -n "${radarr_moviefile_path:-}" ]; then
        service="radarr"
        media_type="movie"
        title="${radarr_movie_title:-}"
        year="${radarr_movie_year:-}"
        arr_item_id="${radarr_movie_id:-}"
        arr_file_id="${radarr_moviefile_id:-}"
        tmdb_id="${radarr_movie_tmdbid:-}"
        imdb_id="${radarr_movie_imdbid:-}"
        tvdb_id=""
        release_title="${radarr_release_title:-${radarr_moviefile_scenename:-}}"
        indexer="${radarr_release_indexer:-}"
        download_client="${radarr_download_client:-}"
        download_id="${radarr_download_id:-}"
        quality="${radarr_release_quality:-}"
        release_size="${radarr_release_size:-}"
        source_path="${radarr_moviefile_sourcepath:-${radarr_moviefile_sourcefolder:-}}"
        imported_path="${radarr_moviefile_path:-}"
    else
        service="sonarr"
        media_type="episode"
        title="${sonarr_series_title:-}"
        year="${sonarr_series_year:-}"
        arr_item_id="${sonarr_series_id:-}"
        arr_file_id="${sonarr_episodefile_id:-}"
        tmdb_id=""
        imdb_id="${sonarr_series_imdbid:-}"
        tvdb_id="${sonarr_series_tvdbid:-}"
        release_title="${sonarr_release_title:-${sonarr_episodefile_scenename:-}}"
        indexer="${sonarr_release_indexer:-}"
        download_client="${sonarr_download_client:-}"
        download_id="${sonarr_download_id:-}"
        quality="${sonarr_release_quality:-}"
        release_size="${sonarr_release_size:-}"
        source_path="${sonarr_episodefile_sourcepath:-${sonarr_sourcepath:-${sonarr_sourcefolder:-}}}"
        imported_path="${sonarr_episodefile_path:-}"
    fi

    if jq -n \
        --arg recordedAt "$recorded_at" \
        --arg service "$service" \
        --arg mediaType "$media_type" \
        --arg eventType "${event_type:-}" \
        --arg title "$title" \
        --arg year "$year" \
        --arg arrItemId "$arr_item_id" \
        --arg arrFileId "$arr_file_id" \
        --arg tmdbId "$tmdb_id" \
        --arg imdbId "$imdb_id" \
        --arg tvdbId "$tvdb_id" \
        --arg releaseTitle "$release_title" \
        --arg indexer "$indexer" \
        --arg downloadClient "$download_client" \
        --arg downloadId "$download_id" \
        --arg quality "$quality" \
        --arg releaseSize "$release_size" \
        --arg sourcePath "$source_path" \
        --arg importedPath "$imported_path" \
        --arg torrentFile "$(basename "$destination_path")" \
        '{
            schemaVersion: 1,
            recordedAt: $recordedAt,
            service: $service,
            mediaType: $mediaType,
            eventType: $eventType,
            title: $title,
            year: $year,
            arrItemId: $arrItemId,
            arrFileId: $arrFileId,
            tmdbId: $tmdbId,
            imdbId: $imdbId,
            tvdbId: $tvdbId,
            releaseTitle: $releaseTitle,
            indexer: $indexer,
            downloadClient: $downloadClient,
            downloadId: $downloadId,
            quality: $quality,
            releaseSize: $releaseSize,
            sourcePath: $sourcePath,
            importedPath: $importedPath,
            torrentFile: $torrentFile
        } | with_entries(select(.value != ""))' > "$temporary_path"; then
        mv -f "$temporary_path" "$manifest_path"
        log "archive-torrent: wrote provenance manifest to $manifest_path"
    else
        rm -f "$temporary_path"
        log "archive-torrent: failed to write provenance manifest; the .torrent file remains archived"
    fi
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
            archive_root="$TORRENT_ARCHIVE_ROOT/Movies"
            ;;
        /tv/*)
            relative_path="${media_path#/tv/}"
            archive_root="$TORRENT_ARCHIVE_ROOT/TV Shows"
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
        find_torrent_file "$QBITTORRENT_TORRENT_STATE_DIR" "$download_id" ||
        find_torrent_file "$TRANSMISSION_TORRENT_STATE_DIR" "$download_id" ||
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
    write_provenance_manifest "$destination_path"
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
