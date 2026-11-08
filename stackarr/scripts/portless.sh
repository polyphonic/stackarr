#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$ROOT_DIR/lib/common.sh"

# Static aliases preserve published HTTP ports and Docker project identity.
# Do not use `portless compose`, force-takeover, or proxy-private state files.
ensure_portless_path() {
    if ! command -v portless >/dev/null 2>&1; then
        local directory
        for directory in "$HOME/.local/bin" "$HOME/.npm-global/bin" "$HOME/n/bin"; do
            [[ ! -d "$directory" ]] || PATH="$directory:$PATH"
        done
        if ! command -v portless >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
            directory="$(npm prefix -g 2>/dev/null || true)"
            [[ ! -d "$directory/bin" ]] || PATH="$directory/bin:$PATH"
        fi
        export PATH
    fi
    command -v portless >/dev/null 2>&1 || fail "Install Node.js 24+ and Portless 0.15.11 or newer on the host (npm install -g portless), then retry. Stackarr does not upgrade a shared proxy automatically."
}

register() { printf '%s\t%s\n' "$1" "$2"; }
optional_alias() {
    case "$(lowercase "$1")" in
        1|true|yes|on) register "$2" "$3" ;;
    esac
}
register_aliases() {
    if stackarr_web_enabled; then register app "${STACKARR_WEB_PORT:-7777}"; fi
    case "$(lowercase "${PREFERRED_TORRENT_CLIENT:-transmission}")" in
        qbittorrent|qbit|qb) register qbittorrent "${QBITTORRENT_WEBUI_PORT:-8081}" ;;
        *) register transmission 9091 ;;
    esac
    register prowlarr 9696
    register radarr 7878
    register sonarr 8989
    optional_alias "${ENABLE_4K_SERVARR:-true}" radarr4k 7879
    optional_alias "${ENABLE_4K_SERVARR:-true}" sonarr4k 8990
    optional_alias "${ENABLE_LIDARR:-true}" lidarr 8686
    optional_alias "${ENABLE_BOOKORBIT:-false}" bookorbit "${BOOKORBIT_WEB_PORT:-42873}"
    optional_alias "${ENABLE_IMMICH:-false}" immich "${IMMICH_WEB_PORT:-2283}"
    optional_alias "${ENABLE_ROMM:-false}" romm "${ROMM_WEB_PORT:-7583}"
    optional_alias "${ENABLE_QUESTARR:-false}" questarr "${QUESTARR_WEB_PORT:-7584}"
    optional_alias "${ENABLE_YOUTARR:-false}" youtarr "${YOUTARR_WEB_PORT:-3087}"
    optional_alias "${ENABLE_BAZARR:-true}" bazarr 6767
    optional_alias "${ENABLE_TINYMEDIAMANAGER:-true}" tinymm 4000
    optional_alias "${ENABLE_FLARESOLVERR:-true}" flaresolverr 8191
    optional_alias "${ENABLE_TIDARR:-true}" tidarr 8484
    optional_alias "${ENABLE_SEERR:-true}" seerr 5055
    optional_alias "${ENABLE_PULSARR:-true}" pulsarr "${PULSARR_PORT:-3003}"
    optional_alias "${ENABLE_TDARR:-false}" tdarr "${TDARR_WEB_PORT:-8265}"
    optional_alias "${ENABLE_MAINTAINERR:-false}" maintainerr "${MAINTAINERR_PORT:-6246}"
    optional_alias "${ENABLE_CLEANUPARR:-false}" cleanuparr "${CLEANUPARR_PORT:-11011}"
    optional_alias "${ENABLE_HOMEASSISTANT:-false}" home "${HOMEASSISTANT_PORT:-8123}"
    optional_alias "${ENABLE_FRIGATE:-false}" frigate "${FRIGATE_PORT:-8971}"
    optional_alias "${ENABLE_AGREGARR:-false}" agregarr "${AGREGARR_PORT:-7171}"
    optional_alias "${ENABLE_TRACEARR:-false}" tracearr "${TRACEARR_PORT:-3000}"
    case "$(lowercase "${PLEX_INSTALL_MODE:-native}")" in
        disabled) ;;
        docker) register plex "${PLEX_DOCKER_PORT:-32400}" ;;
        *) register plex 32400 ;;
    esac
    if [[ "$(lowercase "${JELLYFIN_INSTALL_MODE:-disabled}")" != disabled ]]; then
        register jellyfin "${JELLYFIN_DOCKER_PORT:-8096}"
    fi
}

cmd="${1:-apply}"
case "$cmd" in
    apply|install|status|uninstall) ;;
    *) fail "Usage: stackarr portless apply|install|status|uninstall" ;;
esac
ensure_portless_path
require_command node
# The authoritative runtime loader preserves existing UI choices, origin ports,
# host-reachable MCP URLs and native database bootstrap. Never stage a full host
# runtime from a source checkout as a side effect of Portless install/status.
load_env
export STACKARR_SERVICE_URL_HOST_SUFFIX="${STACKARR_SERVICE_URL_HOST_SUFFIX:-stack}"
export STACKARR_SERVICE_URL_SCHEME="${STACKARR_SERVICE_URL_SCHEME:-https}"
export STATE_ROOT
if [[ "$cmd" != uninstall ]]; then
    register_aliases | node "$ROOT_DIR/scripts/portless-routes.cjs" "$cmd"
else
    node "$ROOT_DIR/scripts/portless-routes.cjs" "$cmd"
fi
