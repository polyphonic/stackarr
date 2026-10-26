#!/bin/sh
# Arr custom script: archive hash-identified torrent files, not download URLs.
set -eu

TORRENT_ARCHIVE_ROOT="${TORRENT_ARCHIVE_ROOT:-/torrent-archive}"
TORRENT_CAPTURE_ROOT="${TORRENT_CAPTURE_ROOT:-$TORRENT_ARCHIVE_ROOT/.metadata/_Captured}"
QBITTORRENT_TORRENT_STATE_DIR="${QBITTORRENT_TORRENT_STATE_DIR:-/torrent-client-state/qbittorrent}"
TRANSMISSION_TORRENT_STATE_DIR="${TRANSMISSION_TORRENT_STATE_DIR:-/torrent-client-state/transmission}"
log() { printf 'archive-torrent: %s\n' "$*" >&2; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

safe_component() {
    case "$1" in ''|.|..|*'/'*|*'\'*) return 1 ;; esac
    [ "$(printf '%s' "$1" | LC_ALL=C tr -d '[:cntrl:]')" = "$1" ]
}

safe_directory() {
    current="$TORRENT_ARCHIVE_ROOT"
    [ -d "$current" ] && [ ! -L "$current" ] || return 1
    for component in "$@"; do
        safe_component "$component" || return 1
        current="$current/$component"
        [ ! -L "$current" ] || return 1
        mkdir -p "$current" || return 1
        [ -d "$current" ] && [ ! -L "$current" ] || return 1
    done
    printf '%s\n' "$current"
}

valid_hash() {
    case "$1" in *[!0-9a-fA-F]*|'') return 1 ;; esac
    [ "${#1}" -eq 40 ] || [ "${#1}" -eq 64 ]
}

# Requests are triggers, never evidence that an old source can be retired.
request_current_sources() {
    [ "$event_type" != Grab ] || return 0
    case "$arr_item_id" in ''|*[!0-9]*) return 0 ;; esac
    command -v jq >/dev/null 2>&1 || return 0
    pending="$(safe_directory _Pending "$instance")" || return 1
    request="$pending/$arr_item_id.json"
    [ ! -L "$request" ] || return 1
    temporary="$(umask 077; mktemp "$pending/.request.XXXXXXXXXX")" || return 1
    if jq -n --arg instance "$instance" --arg id "$arr_item_id" \
        --arg hash "$download_id" --arg at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        '{schemaVersion:1, instance:$instance, arrItemId:$id, downloadId:$hash, requestedAt:$at}' > "$temporary"; then
        mv -f "$temporary" "$request"
    else
        rm -f "$temporary"
        return 1
    fi
}

find_in_state() {
    base="$1"
    for hash in "$download_id" "$(lower "$download_id")" "$(upper "$download_id")"; do
        candidate="$base/$hash.torrent"
        if [ -f "$candidate" ] && [ ! -L "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

find_torrent_file() {
    case "$(lower "$download_client")" in
        *qbittorrent*) find_in_state "$QBITTORRENT_TORRENT_STATE_DIR" ;;
        *transmission*) find_in_state "$TRANSMISSION_TORRENT_STATE_DIR" ;;
        *)
            qb="$(find_in_state "$QBITTORRENT_TORRENT_STATE_DIR" || true)"
            tr="$(find_in_state "$TRANSMISSION_TORRENT_STATE_DIR" || true)"
            if [ -n "$qb" ] && [ -n "$tr" ] && ! cmp -s "$qb" "$tr"; then
                if verified "$qb"; then printf '%s\n' "$qb"; return 0; fi
                if verified "$tr"; then printf '%s\n' "$tr"; return 0; fi
                log 'ambiguous unverified client torrent state; trying captured metadata'
                return 1
            fi
            [ -n "$qb" ] && { printf '%s\n' "$qb"; return 0; }
            [ -n "$tr" ] && { printf '%s\n' "$tr"; return 0; }
            return 1 ;;
    esac
}

# Link a private temporary copy atomically: no release may overwrite an existing one.
copy_exact() {
    target="$1"
    if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] && cmp -s "$source" "$target"
        return $?
    fi
    temporary="$(umask 077; mktemp "$target.tmp.XXXXXXXXXX")" || return 1
    cp "$source" "$temporary" || { rm -f "$temporary"; return 1; }
    if ! ln "$temporary" "$target" 2>/dev/null; then
        rm -f "$temporary"
        [ -f "$target" ] && [ ! -L "$target" ] && cmp -s "$source" "$target"
        return $?
    fi
    rm -f "$temporary"
}

sidecar_allowed() {
    target="$1"
    sidecar="${target%.torrent}.provenance.json"
    if [ -e "$sidecar" ] || [ -L "$sidecar" ]; then
        if [ ! -L "$sidecar" ] && [ -f "$sidecar" ] && command -v jq >/dev/null 2>&1 &&
            jq -e --arg id "$download_id" --arg file "${target##*/}" \
                '.downloadId == $id and .torrentFile == $file' "$sidecar" >/dev/null 2>&1; then
            return 0
        fi
        log 'existing provenance does not match torrent association; refusing'
        return 1
    fi
}

manifest() {
    target="$1"
    sidecar="${target%.torrent}.provenance.json"
    sidecar_allowed "$target" || return 1
    [ ! -e "$sidecar" ] && [ ! -L "$sidecar" ] || return 0
    command -v jq >/dev/null 2>&1 || { log 'jq unavailable; torrent retained without sidecar'; return 0; }
    temp="$(umask 077; mktemp "$sidecar.tmp.XXXXXXXXXX")" || {
        log 'provenance sidecar temporary creation failed; torrent retained'; return 0;
    }
    if jq -n --arg service "$service" --arg eventType "$event_type" \
        --arg recordedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        --arg downloadId "$download_id" --arg releaseTitle "$release_title" \
        --arg title "$title" --arg year "$year" \
        --arg tmdbId "$tmdb_id" --arg imdbId "$imdb_id" --arg tvdbId "$tvdb_id" \
        --arg releaseSize "$release_size" --arg arrItemId "$arr_item_id" \
        --arg arrFileId "$arr_file_id" --arg indexer "$indexer" \
        --arg downloadClient "$download_client" --arg quality "$quality" \
        --arg sourcePath "$source_path" --arg importedPath "$imported_path" \
        --arg torrentFile "${target##*/}" --arg instance "$instance" \
        '{schemaVersion: 1, archiveScope: "torrent-source", provenanceCoverage: "first-successful-import",
          instance: $instance,
          recordedAt: $recordedAt, service: $service,
          mediaType: (if $service == "radarr" then "movie" else "episode" end),
          eventType: $eventType, title: $title, year: $year,
          tmdbId: $tmdbId, imdbId: $imdbId, tvdbId: $tvdbId,
          releaseSize: $releaseSize, arrItemId: $arrItemId,
          arrFileId: $arrFileId, releaseTitle: $releaseTitle, indexer: $indexer,
          downloadClient: $downloadClient, downloadId: $downloadId,
          quality: $quality, sourcePath: $sourcePath, importedPath: $importedPath,
          torrentFile: $torrentFile} | with_entries(select(.value != ""))' > "$temp"; then
        ln "$temp" "$sidecar" 2>/dev/null || :
    else
        log 'provenance sidecar generation failed; torrent retained'
    fi
    rm -f "$temp"
}

service=''
if [ -n "${radarr_eventtype:-}" ]; then
    service=radarr
    event_type="$radarr_eventtype"
    download_id="${radarr_download_id:-}"
    imported_path="${radarr_moviefile_path:-}"
    title="${radarr_movie_title:-}"
    year="${radarr_movie_year:-}"
    tmdb_id="${radarr_movie_tmdbid:-}"
    imdb_id="${radarr_movie_imdbid:-}"
    tvdb_id=''
    release_size="${radarr_release_size:-}"
    arr_item_id="${radarr_movie_id:-}"
    arr_file_id="${radarr_moviefile_id:-}"
    release_title="${radarr_release_title:-${radarr_moviefile_scenename:-}}"
    indexer="${radarr_release_indexer:-}"
    download_client="${radarr_download_client:-}"
    quality="${radarr_release_quality:-}"
    source_path="${radarr_moviefile_sourcepath:-${radarr_moviefile_sourcefolder:-}}"
elif [ -n "${sonarr_eventtype:-}" ]; then
    service=sonarr
    event_type="$sonarr_eventtype"
    download_id="${sonarr_download_id:-}"
    imported_path="${sonarr_episodefile_path:-}"
    title="${sonarr_series_title:-}"
    year="${sonarr_series_year:-}"
    tmdb_id=''
    imdb_id="${sonarr_series_imdbid:-}"
    tvdb_id="${sonarr_series_tvdbid:-}"
    release_size="${sonarr_release_size:-}"
    arr_item_id="${sonarr_series_id:-}"
    arr_file_id="${sonarr_episodefile_id:-}"
    release_title="${sonarr_release_title:-${sonarr_episodefile_scenename:-}}"
    indexer="${sonarr_release_indexer:-}"
    download_client="${sonarr_download_client:-}"
    quality="${sonarr_release_quality:-}"
    source_path="${sonarr_episodefile_sourcepath:-${sonarr_sourcepath:-${sonarr_sourcefolder:-}}}"
else
    exit 0
fi
case "$event_type" in Grab|Download|Upgrade) ;; *) exit 0 ;; esac
instance="${TORRENT_ARR_INSTANCE:-$service}"
case "$instance" in "$service"|"${service}4k") ;; *) log 'invalid Arr instance'; exit 1 ;; esac
[ -n "$download_id" ] || exit 0
valid_hash "$download_id" || { log 'invalid download hash; skipping'; exit 0; }
download_id="$(upper "$download_id")"
safe_component "$release_title" || release_title="$download_id"
# Bound UTF-8 bytes, leaving room for a 64-character v2 collision suffix.
if [ "$(LC_ALL=C printf '%s' "$release_title" | wc -c | tr -d ' ')" -gt 140 ]; then
    if command -v jq >/dev/null 2>&1; then
        release_title="$(jq -nr --arg title "$release_title" '
            $title | explode | reduce .[] as $cp ({out:[], bytes:0, full:false};
              (if $cp < 128 then 1 elif $cp < 2048 then 2 elif $cp < 65536 then 3 else 4 end) as $size |
              if .full or .bytes + $size > 140 then .full = true
              else .out += [$cp] | .bytes += $size end) |
            .out | implode | sub("[ .]+$"; "")')"
    else
        release_title="$download_id"
    fi
fi
[ -n "$release_title" ] || release_title="$download_id"
case "$release_title" in *.torrent) release_title="${release_title%.torrent}" ;; esac
stem="$release_title"

mkdir -p "$TORRENT_ARCHIVE_ROOT" || exit 1
[ ! -L "$TORRENT_ARCHIVE_ROOT" ] || exit 1
request_current_sources || { log 'current-source request failed'; exit 1; }
staging="$(safe_directory _Unresolved "$service")" || exit 1
staged="$staging/$download_id.torrent"
verifier="$(dirname "$0")/torrent-verify.sh"
[ -f "$verifier" ] && [ ! -L "$verifier" ] || { log 'metainfo verifier unavailable'; exit 1; }
verified() { sh "$verifier" "$1" "$download_id"; }
# Existing verified bytes win even when a client rewrites only tracker wrappers.
# Never let an unverified client stub conceal captured completed metadata.
[ ! -L "$staged" ] || { log 'staged torrent is a symlink'; exit 1; }
source=''
if [ -f "$staged" ] && verified "$staged"; then
    source="$staged"
else
    client_source=''
    if client_source="$(find_torrent_file)"; then
        :
    else
        lookup_status=$?
        [ "$lookup_status" -eq 1 ] || exit 1
    fi
    if [ -n "$client_source" ] && verified "$client_source"; then
        source="$client_source"
    fi
    captured="$TORRENT_CAPTURE_ROOT/$download_id.torrent"
    if [ -z "$source" ] && [ -f "$captured" ] &&
       [ ! -L "${TORRENT_CAPTURE_ROOT%/*}" ] &&
       [ ! -L "$TORRENT_CAPTURE_ROOT" ] && [ ! -L "$captured" ] &&
       verified "$captured"; then
        source="$captured"
    fi
    if [ -z "$source" ]; then
        log 'completed hash-matched metainfo not yet available; will retry on import'
        exit 0
    fi
    if [ -f "$staged" ]; then
        # Preserve a poisoned legacy stage on this archive filesystem before
        # atomically replacing it. A verified stage is never overwritten.
        private="$(umask 077; safe_directory .metadata _Rejected "$service")" || exit 1
        chmod 700 "$private" || exit 1
        old="$(umask 077; mktemp "$private/$download_id.XXXXXXXXXX.torrent")" || exit 1
        cp "$staged" "$old" || { rm -f "$old"; exit 1; }
        cmp -s "$old" "$staged" || { rm -f "$old"; exit 1; }
        temporary="$(umask 077; mktemp "$staged.tmp.XXXXXXXXXX")" || exit 1
        cp "$source" "$temporary" && verified "$temporary" &&
            mv -f "$temporary" "$staged" || { rm -f "$temporary"; exit 1; }
    else
        copy_exact "$staged" || { log 'staged torrent collision'; exit 1; }
    fi
fi
# Recheck the actual staged bytes; no source reaches primary without this proof.
verified "$staged" || { log 'staged torrent failed verification'; exit 1; }
[ "$event_type" != Grab ] || { log 'staged unresolved grab'; exit 0; }
[ -n "$imported_path" ] || { log 'import event has no library path; retained unresolved'; exit 0; }

case "$imported_path" in
    /movies/*/*) [ "$service" = radarr ] || exit 0
        relative="${imported_path#/movies/}"
        set -- Movies ;;
    /tv/*/*) [ "$service" = sonarr ] || exit 0
        relative="${imported_path#/tv/}"
        show="${imported_path#/tv/}"
        show="${show%%/*}"
        safe_component "$show" || { log 'unsafe show path; retained unresolved'; exit 0; }
        helper="${TORRENT_SEASONS_HELPER:-$(dirname "$0")/torrent-seasons.sh}"
        if [ ! -f "$helper" ] || [ -L "$helper" ]; then
            log 'metainfo classifier unavailable; retained unresolved'
            exit 0
        fi
        classification="$(sh "$helper" "$staged" --single-evidence)" || { log 'metainfo classification failed; retained unresolved'; exit 0; }
        case "$classification" in
            multi) set -- 'TV Shows' ;;
            'one unknown')
                season="${sonarr_episodefile_seasonnumber:-}"
                case "$season" in ''|*[!0-9]*) log 'import season unavailable; retained unresolved'; exit 0 ;; esac
                # A filename explicitly marked for another season overrides the
                # event field; never use import evidence to conceal a mismatch.
                filename="${imported_path##*/}"
                explicit="$(printf '%s' "$filename" | sed -nE 's/.*[sS]([0-9]{1,2})[eE][0-9]{1,3}.*/\1/p')"
                [ -n "$explicit" ] || explicit="$(printf '%s' "$filename" | sed -nE 's/.*[^0-9]([0-9]{1,2})[xX][0-9]{1,3}.*/\1/p')"
                if [ -n "$explicit" ] && [ "$explicit" -ne "$season" ] 2>/dev/null; then
                    log 'import filename conflicts with season evidence; retained unresolved'; exit 0
                fi
                set -- 'TV Shows' ;;
            'single '*)
                set -- 'TV Shows'
                season="${classification#single }"
                case "$season" in ''|*[!0-9]*) log 'invalid season classification; retained unresolved'; exit 0 ;; esac
                # The Arr event is authoritative; a filename is corroborating evidence.
                filename="${imported_path##*/}"
                filename_season="$(printf '%s' "$filename" | sed -nE 's/.*[sS]([0-9]{1,2})[eE][0-9]{1,3}.*/\1/p')"
                [ -n "$filename_season" ] || filename_season="$(printf '%s' "$filename" | sed -nE 's/.*[^0-9]([0-9]{1,2})[xX][0-9]{1,3}.*/\1/p')"
                episode_season="${sonarr_episodefile_seasonnumber:-$filename_season}"
                case "$episode_season" in ''|*[!0-9]*) log 'import season unavailable; retained unresolved'; exit 0 ;; esac
                if [ -n "$filename_season" ] && [ "$filename_season" -ne "$episode_season" ] 2>/dev/null; then
                    log 'import filename conflicts with Arr season; retained unresolved'; exit 0
                fi
                episode_season="$(printf '%s' "$episode_season" | sed 's/^0*//')"
                [ -n "$episode_season" ] || episode_season=0
                [ "$episode_season" -eq "$season" ] 2>/dev/null || {
                    log 'import season conflicts with metainfo; retained unresolved'; exit 0;
                }
                relative="${imported_path#/tv/}" ;;
            *) log 'ambiguous metainfo; retained unresolved'; exit 0 ;;
        esac
        ;;
    *) log 'unrecognized library path; retained unresolved'; exit 0 ;;
esac
if [ "$service" = sonarr ]; then
    if [ "$classification" = multi ]; then
        relative="$show/${imported_path##*/}"
    else
        # The show comes from Arr's library path. Its season directory is
        # rendered from Sonarr's configured format, never a stale source dir.
        case "$imported_path" in
            "/tv/$show/"*/*/*) log 'nested TV path; retained unresolved'; exit 0 ;;
            "/tv/$show/"*/*) season_folder_present=true ;;
            "/tv/$show/"*) season_folder_present=false ;;
            *) log 'unsafe TV path; retained unresolved'; exit 0 ;;
        esac
        if [ "$season_folder_present" = true ]; then
            library_folder="${imported_path#"/tv/$show/"}"
            library_folder="${library_folder%%/*}"
            folder_season="$(printf '%s' "$library_folder" | sed -nE 's/^[Ss]eason[ ._-]*([0-9]{1,2})$/\1/p; s/^[Ss]([0-9]{1,2})$/\1/p')"
            case "$library_folder" in [Ss]pecials) folder_season=0 ;; esac
            if [ -n "$folder_season" ] && [ "$folder_season" -ne "$season" ] 2>/dev/null; then
                log 'library season directory conflicts with metainfo/import; retained unresolved'; exit 0
            fi
        fi
        relative="$show/${imported_path##*/}"
        if [ "$season_folder_present" = true ]; then
            naming="${TORRENT_SONARR_NAMING_CONFIG:-/stackarr-hooks/sonarr-naming.json}"
            [ -f "$naming" ] && [ ! -L "$naming" ] && command -v jq >/dev/null 2>&1 || {
                log 'Sonarr naming configuration unavailable; retained unresolved'; exit 0;
            }
            if [ "$season" -eq 0 ]; then
                folder="$(jq -er '.specialsFolderFormat | select(type == "string" and length > 0)' "$naming" 2>/dev/null)" || {
                    log 'specials naming unavailable; retained unresolved'; exit 0;
                }
            else
                format="$(jq -er '.seasonFolderFormat | select(type == "string" and length > 0)' "$naming" 2>/dev/null)" || {
                    log 'season naming unavailable; retained unresolved'; exit 0;
                }
                padded="$(printf '%02d' "$season")"
                case "$format" in
                    *'{season:00}'*) folder="${format%%\{season:00\}*}$padded${format#*\{season:00\}}" ;;
                    *'{season}'*) folder="${format%%\{season\}*}$season${format#*\{season\}}" ;;
                    *) log 'unsupported season naming format; retained unresolved'; exit 0 ;;
                esac
                case "$folder" in *'{'*|*'}'*) log 'ambiguous season naming format; retained unresolved'; exit 0 ;; esac
            fi
            safe_component "$folder" || { log 'unsafe season folder; retained unresolved'; exit 0; }
            relative="$show/$folder/${imported_path##*/}"
        fi
    fi
fi
# Split without normalising: retain the actual on-disk directory names, including
# Specials and shows configured without a season folder. Reject empty/dot segments.
while :; do
    case "$relative" in
        */*) component="${relative%%/*}"
             safe_component "$component" || { log 'unsafe library path; retained unresolved'; exit 0; }
             set -- "$@" "$component"
             relative="${relative#*/}" ;;
        *) safe_component "$relative" || { log 'unsafe library filename; retained unresolved'; exit 0; }
           break ;;
    esac
done
destination="$(safe_directory "$@")" || exit 1
source="$staged"
target="$destination/$stem.torrent"
if [ -e "$target" ] || [ -L "$target" ]; then
    if [ ! -L "$target" ] && [ -f "$target" ] && verified "$target"; then
        # Same raw info identity: retain the original valid tracker wrapper.
        source="$target"
        sidecar_allowed "$target" || exit 1
    elif [ ! -L "$target" ] && [ -f "$target" ] &&
         ! sh "$verifier" "$target" -; then
        sidecar_allowed "$target" || exit 1
        private="$(umask 077; safe_directory .metadata _Rejected "$service")" || exit 1
        chmod 700 "$private" || exit 1
        old="$(umask 077; mktemp "$private/$download_id.XXXXXXXXXX.torrent")" || exit 1
        cp "$target" "$old" && cmp -s "$target" "$old" || { rm -f "$old"; exit 1; }
        temporary="$(umask 077; mktemp "$target.tmp.XXXXXXXXXX")" || exit 1
        cp "$source" "$temporary" && verified "$temporary" &&
            mv -f "$temporary" "$target" || { rm -f "$temporary"; exit 1; }
        source="$target"
    else
        target="$destination/$stem [$download_id].torrent"
        sidecar_allowed "$target" || exit 1
        if [ -f "$target" ] && [ ! -L "$target" ] && verified "$target"; then
            source="$target"
        fi
    fi
else
    sidecar_allowed "$target" || exit 1
fi
copy_exact "$target" || { log 'archive collision; retained unresolved'; exit 1; }
manifest "$target" || exit 1
request_current_sources || exit 1
log 'archived imported torrent'
