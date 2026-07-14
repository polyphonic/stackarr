#!/bin/sh
set -eu

log() {
    printf '%s\n' "post-import-media: $*" >&2
}

normalize_name() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]'
}

plex_extra_directory() {
    normalized="$(normalize_name "$1")"

    case "$normalized" in
        behindthescenes|behindscenes|bts)
            printf '%s\n' "Behind The Scenes"
            ;;
        deletedscene|deletedscenes|deleted)
            printf '%s\n' "Deleted Scenes"
            ;;
        featurette|featurettes|makingof|makingofs|bonusfeature|bonusfeatures|specialfeature|specialfeatures)
            printf '%s\n' "Featurettes"
            ;;
        interview|interviews)
            printf '%s\n' "Interviews"
            ;;
        scene|scenes)
            printf '%s\n' "Scenes"
            ;;
        short|shorts)
            printf '%s\n' "Shorts"
            ;;
        trailer|trailers)
            printf '%s\n' "Trailers"
            ;;
        extra|extras|other|others)
            printf '%s\n' "Other"
            ;;
        *)
            return 1
            ;;
    esac
}

is_video_file() {
    extension="$(printf '%s' "${1##*.}" | tr '[:upper:]' '[:lower:]')"

    case "$extension" in
        mkv|mp4|m4v|avi|mov|mpg|mpeg|ts|m2ts|webm)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

copy_extra_file() {
    source_file="$1"
    destination_root="$2"
    plex_directory="$3"
    destination_directory="$destination_root/$plex_directory"
    filename="$(basename "$source_file")"
    destination_file="$destination_directory/$filename"

    case "$(normalize_name "${filename%.*}")" in
        sample*)
            return 0
            ;;
    esac

    mkdir -p "$destination_directory"
    if [ -f "$destination_file" ]; then
        if cmp -s "$source_file" "$destination_file"; then
            log "extra already present at $destination_file"
            return 0
        fi

        stem="${filename%.*}"
        extension="${filename##*.}"
        suffix=2
        while [ -e "$destination_directory/$stem ($suffix).$extension" ]; do
            suffix=$((suffix + 1))
        done
        destination_file="$destination_directory/$stem ($suffix).$extension"
    fi

    cp "$source_file" "$destination_file"
    log "copied Plex extra to $destination_file"
}

copy_extra_tree() {
    source_directory="$1"
    destination_root="$2"
    plex_directory="$3"

    for entry in "$source_directory"/*; do
        [ -e "$entry" ] || continue
        if [ -d "$entry" ]; then
            copy_extra_tree "$entry" "$destination_root" "$plex_directory"
        elif [ -f "$entry" ] && is_video_file "$entry"; then
            copy_extra_file "$entry" "$destination_root" "$plex_directory"
        fi
    done
}

find_and_copy_extra_directories() {
    source_directory="$1"
    destination_root="$2"

    for entry in "$source_directory"/*; do
        [ -e "$entry" ] || continue
        [ -d "$entry" ] || continue

        if plex_directory="$(plex_extra_directory "$(basename "$entry")")"; then
            copy_extra_tree "$entry" "$destination_root" "$plex_directory"
        else
            find_and_copy_extra_directories "$entry" "$destination_root"
        fi
    done
}

read_tmm_api_key() {
    if [ -n "${TMM_API_KEY:-}" ]; then
        printf '%s' "$TMM_API_KEY"
        return 0
    fi

    key_file="${TMM_API_KEY_FILE:-/stackarr-hooks/tinymediamanager-api-key}"
    [ -r "$key_file" ] || return 1
    tr -d '\r\n' < "$key_file"
}

update_and_scrape_tmm() {
    media_type="$1"
    api_key="$(read_tmm_api_key || true)"
    api_url="${TMM_API_URL:-http://tinymediamanager:7878}"

    if [ -z "$api_key" ]; then
        log "tinyMediaManager API key is unavailable; skipping scrape"
        return 0
    fi

    case "$media_type" in
        movie)
            endpoint="movie"
            ;;
        tvshow)
            endpoint="tvshow"
            ;;
        *)
            log "unsupported media type '$media_type'"
            return 0
            ;;
    esac

    payload='[{"action":"update","scope":{"name":"all"}},{"action":"scrape","scope":{"name":"new"}}]'
    if curl -fsS \
        --connect-timeout "${TMM_CONNECT_TIMEOUT:-5}" \
        --max-time "${TMM_REQUEST_TIMEOUT:-30}" \
        -X POST "$api_url/api/$endpoint" \
        -H "api-key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null; then
        log "tinyMediaManager $media_type database update and new-item scrape started"
    else
        log "tinyMediaManager $media_type API request failed; Arr import remains complete"
    fi
}

event_type="${radarr_eventtype:-${sonarr_eventtype:-}}"
case "$event_type" in
    ""|Test|Grab|Rename|SeriesDeleted|EpisodeDeleted|MovieDeleted|MovieFileDelete|MovieFileDeleteForUpgrade|HealthIssue)
        exit 0
        ;;
esac

media_type=""
source_directory=""
destination_root=""

if [ -n "${radarr_movie_path:-}" ]; then
    media_type="movie"
    if [ -n "${radarr_moviefile_sourcepath:-}" ]; then
        if [ -d "$radarr_moviefile_sourcepath" ]; then
            source_directory="$radarr_moviefile_sourcepath"
        else
            source_directory="$(dirname "$radarr_moviefile_sourcepath")"
        fi
    else
        source_directory="${radarr_moviefile_sourcefolder:-}"
    fi
    destination_root="$radarr_movie_path"
elif [ -n "${sonarr_series_path:-}" ]; then
    media_type="tvshow"
    source_directory="${sonarr_sourcepath:-${sonarr_sourcefolder:-}}"
    if [ -f "$source_directory" ]; then
        source_directory="$(dirname "$source_directory")"
    fi
    destination_root="$sonarr_series_path"
fi

if [ -z "$media_type" ] || [ -z "$destination_root" ]; then
    log "no supported completed-import context found"
    exit 0
fi

if [ -n "$source_directory" ] && [ -d "$source_directory" ] && [ "$source_directory" != "$destination_root" ]; then
    find_and_copy_extra_directories "$source_directory" "$destination_root"
fi

update_and_scrape_tmm "$media_type"
