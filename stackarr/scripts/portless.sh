#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$ROOT_DIR/lib/common.sh"

STACKARR_BIN=""
PLIST_DIR=""
PLIST_PATH=""
LAUNCH_DOMAIN=""
REGISTERED_ALIASES=()

host_install_hint() {
    echo "Open Terminal and run:"
    echo "  stackarr portless install"
    echo "Source checkouts can use:"
    echo "  bin/stackarr portless install"
}

load_browser_link_settings() {
    local db_file
    db_file="$(default_stackarr_database_file)"
    local exporter="$ROOT_DIR/scripts/settings-export.cjs"

    : "${STACKARR_SERVICE_URL_MODE:=localhost}"
    : "${STACKARR_SERVICE_URL_SCHEME:=https}"
    : "${STACKARR_SERVICE_URL_HOST_SUFFIX:=stack}"
    : "${STACKARR_UNIFY_SERVICE_URLS:=false}"

    [[ -n "${STACKARR_DATABASE_URL:-}" || -f "$db_file" ]] || return 0
    [[ -f "$exporter" ]] || return 0
    command -v node >/dev/null 2>&1 || return 0

    local exports
    if exports="$(STACKARR_DATABASE_FILE="$db_file" node "$exporter")"; then
        eval "$exports"
    fi
}

ensure_portless_path() {
    command -v portless >/dev/null 2>&1 && return 0
    command -v npm >/dev/null 2>&1 || return 0

    local prefix bin_from_prefix root bin_from_root
    prefix="$(npm prefix -g 2>/dev/null || true)"
    if [[ -n "$prefix" && -d "$prefix/bin" ]]; then
        PATH="$prefix/bin:$PATH"
    fi

    root="$(npm root -g 2>/dev/null || true)"
    if [[ -n "$root" && -d "$root/../bin" ]]; then
        bin_from_root="$(cd "$root/../bin" && pwd)"
        PATH="$bin_from_root:$PATH"
    fi

    for bin_from_prefix in "$HOME/.local/bin" "$HOME/.npm-global/bin" "$HOME/n/bin"; do
        [[ -d "$bin_from_prefix" ]] || continue
        PATH="$bin_from_prefix:$PATH"
    done

    export PATH
}

ensure_portless_installed() {
    ensure_portless_path

    if command -v portless >/dev/null 2>&1; then
        return 0
    fi

    if ! command -v npm >/dev/null 2>&1; then
        fail "Portless is not installed and npm is unavailable. Install Node.js/npm, then run 'stackarr portless install'. Source checkouts can use 'bin/stackarr portless install'."
    fi

    warn "Portless is not installed. Installing with npm install -g portless."
    npm install -g portless
    ensure_portless_path
    require_command portless
}

active_portless_tld() {
    local tld_file="$HOME/.portless/proxy.tld"
    local active_tld

    [[ -f "$tld_file" ]] || return 0
    active_tld="$(tr -d '[:space:]' < "$tld_file")"
    active_tld="${active_tld#.}"

    if [[ "$active_tld" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]; then
        printf '%s\n' "$active_tld"
    fi
}

register() {
    local name="$1"
    local port="$2"

    [[ -n "$port" ]] || return 0
    REGISTERED_ALIASES+=("$name")
    PORTLESS_TLD="$tld" portless alias "$name" "$port" --force
    ensure_route_file_alias "$name" "$port"
    ok "${scheme}://$name.${tld} -> :$port"
}

ensure_route_file_alias() {
    local name="$1"
    local port="$2"
    local routes_file="$HOME/.portless/routes.json"

    command -v node >/dev/null 2>&1 || return 0
    mkdir -p "$(dirname "$routes_file")"

    STACKARR_PORTLESS_ALIAS="$name" \
        STACKARR_PORTLESS_PORT="$port" \
        STACKARR_PORTLESS_TLD="$tld" \
        STACKARR_PORTLESS_ROUTES_FILE="$routes_file" \
        node <<'NODE'
const fs = require('node:fs');

const routesFile = process.env.STACKARR_PORTLESS_ROUTES_FILE;
const alias = String(process.env.STACKARR_PORTLESS_ALIAS || '').trim().toLowerCase();
const tld = String(process.env.STACKARR_PORTLESS_TLD || 'stack').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
const port = Number(process.env.STACKARR_PORTLESS_PORT || 0);

if (!routesFile || !alias || !tld || !port) process.exit(0);

const hostname = `${alias}.${tld}`;
let routes = [];

try {
  routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
  if (!Array.isArray(routes)) routes = [];
} catch {
  routes = [];
}

const next = routes.filter((route) => String(route?.hostname || '').toLowerCase() !== hostname);
next.push({ hostname, port, pid: 0 });

fs.writeFileSync(routesFile, `${JSON.stringify(next, null, 2)}\n`);
NODE
}

register_aliases() {
    if stackarr_web_enabled; then
        register app "${STACKARR_WEB_PORT:-7777}"
    fi

    case "$(lowercase "${PREFERRED_TORRENT_CLIENT:-transmission}")" in
        qbittorrent|qbit|qb)
            register qbittorrent "${QBITTORRENT_WEBUI_PORT:-8081}"
            ;;
        *)
            register transmission 9091
            ;;
    esac

    register prowlarr 9696
    register radarr 7878
    register sonarr 8989

    if truthy "${ENABLE_4K_SERVARR:-true}"; then
        register radarr4k 7879
        register sonarr4k 8990
    fi

    if truthy "${ENABLE_LIDARR:-true}"; then
        register lidarr 8686
    fi

    if truthy "${ENABLE_BOOKORBIT:-false}"; then
        register bookorbit "${BOOKORBIT_WEB_PORT:-42873}"
    fi

    if truthy "${ENABLE_IMMICH:-false}"; then
        register immich "${IMMICH_WEB_PORT:-2283}"
    fi

    if truthy "${ENABLE_ROMM:-false}"; then
        register romm "${ROMM_WEB_PORT:-7583}"
    fi

    if truthy "${ENABLE_QUESTARR:-false}"; then
        register questarr "${QUESTARR_WEB_PORT:-7584}"
    fi

    if truthy "${ENABLE_YOUTARR:-false}"; then
        register youtarr "${YOUTARR_WEB_PORT:-3087}"
    fi

    if truthy "${ENABLE_BAZARR:-true}"; then
        register bazarr 6767
    fi

    if truthy "${ENABLE_TINYMEDIAMANAGER:-true}"; then
        register tinymm 4000
    fi

    if truthy "${ENABLE_FLARESOLVERR:-true}"; then
        register flaresolverr 8191
    fi

    if truthy "${ENABLE_TIDARR:-true}"; then
        register tidarr 8484
    fi

    if truthy "${ENABLE_SEERR:-true}"; then
        register seerr 5055
    fi

    if truthy "${ENABLE_PULSARR:-true}"; then
        register pulsarr "${PULSARR_PORT:-3003}"
    fi

    if truthy "${ENABLE_MAINTAINERR:-false}"; then
        register maintainerr "${MAINTAINERR_PORT:-6246}"
    fi

    if truthy "${ENABLE_CLEANUPARR:-false}"; then
        register cleanuparr "${CLEANUPARR_PORT:-11011}"
    fi

    if truthy "${ENABLE_AGREGARR:-false}"; then
        register agregarr "${AGREGARR_PORT:-7171}"
    fi

    if truthy "${ENABLE_TRACEARR:-false}"; then
        register tracearr "${TRACEARR_PORT:-3000}"
    fi

    if [[ "$(lowercase "${PLEX_INSTALL_MODE:-native}")" != "disabled" ]]; then
        register plex "${PLEX_DOCKER_PORT:-32400}"
    fi

    if [[ "$(lowercase "${JELLYFIN_INSTALL_MODE:-disabled}")" != "disabled" ]]; then
        register jellyfin "${JELLYFIN_DOCKER_PORT:-8096}"
    fi
}

prune_stale_stackarr_aliases() {
    local routes_file="$HOME/.portless/routes.json"
    [[ -f "$routes_file" ]] || return 0
    command -v node >/dev/null 2>&1 || return 0

    local active_aliases
    active_aliases="$(IFS=,; printf '%s' "${REGISTERED_ALIASES[*]}")"

    STACKARR_PORTLESS_TLD="$tld" \
        STACKARR_PORTLESS_ACTIVE_ALIASES="$active_aliases" \
        STACKARR_PORTLESS_ROUTES_FILE="$routes_file" \
        node <<'NODE'
const fs = require('node:fs');

const routesFile = process.env.STACKARR_PORTLESS_ROUTES_FILE;
const tld = String(process.env.STACKARR_PORTLESS_TLD || 'stack').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
const activeAliases = new Set(
  String(process.env.STACKARR_PORTLESS_ACTIVE_ALIASES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const stackarrAliases = new Set([
  'stackarr',
  'app',
  'transmission',
  'qbittorrent',
  'qbit',
  'qb',
  'prowlarr',
  'radarr',
  'sonarr',
  'radarr4k',
  'sonarr4k',
  'lidarr',
  'bookorbit',
  'immich',
  'romm',
  'questarr',
  'youtarr',
  'bazarr',
  'tinymm',
  'flaresolverr',
  'tidarr',
  'seerr',
  'pulsarr',
  'maintainerr',
  'cleanuparr',
  'agregarr',
  'tracearr',
  'plex',
  'jellyfin',
]);
const activeHostnames = new Set([...activeAliases].map((alias) => `${alias}.${tld}`));

try {
  const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
  if (!Array.isArray(routes)) process.exit(0);

  const next = routes.filter((route) => {
    const hostname = String(route?.hostname || '').toLowerCase();
    const parts = hostname.split('.');
    const alias = parts.shift();
    if (!alias || !stackarrAliases.has(alias)) return true;
    return activeHostnames.has(hostname);
  });

  if (next.length === routes.length) process.exit(0);
  fs.copyFileSync(routesFile, `${routesFile}.bak-stackarr-prune`);
  fs.writeFileSync(routesFile, `${JSON.stringify(next, null, 2)}\n`);
} catch {
  process.exit(0);
}
NODE
}

start_proxy() {
    local tld="$1"
    local scheme="$2"
    local output

    if [[ "$scheme" == "http" ]]; then
        portless proxy start --tld "$tld" --no-tls || {
            warn "Portless proxy did not start. Host approval may still be required."
            host_install_hint
        }
        return
    fi

    output="$(portless proxy start --tld "$tld" 2>&1)" || {
        printf '%s\n' "$output"
        warn "Portless proxy did not start. Host approval may still be required."
        host_install_hint
        return
    }

    printf '%s\n' "$output"

    if [[ "$output" == *"port 1355"* || "$output" == *":1355"* ]]; then
        warn "Portless is running on fallback port 1355. Restarting it so clean https://*.$tld URLs can use port 443."
        portless proxy stop -p 1355 >/dev/null 2>&1 || portless proxy stop >/dev/null 2>&1 || true
        output="$(portless proxy start --tld "$tld" 2>&1)" || {
            printf '%s\n' "$output"
            warn "Portless still needs host approval for clean URLs."
            host_install_hint
            return
        }
        printf '%s\n' "$output"
        if [[ "$output" == *"port 1355"* || "$output" == *":1355"* ]]; then
            warn "Portless is still using fallback port 1355, so clean https://*.$tld URLs will not work yet."
            host_install_hint
        fi
    fi
}

setup_launch_agent_paths() {
    STACKARR_BIN="$(install_managed_host_runtime)"
    LAUNCH_APP_ROOT="$(default_app_root)"
    ensure_dir "$LAUNCH_APP_ROOT"
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_PATH="$PLIST_DIR/com.stackarr.portless.plist"
    LAUNCH_DOMAIN="gui/$(id -u)"
    ensure_dir "$PLIST_DIR"
    ensure_dir "$LOG_ROOT/launchd"
}

unload_agent() {
    launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
}

load_agent() {
    launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
    launchctl enable "$LAUNCH_DOMAIN/com.stackarr.portless" 2>/dev/null || true
    launchctl kickstart -k "$LAUNCH_DOMAIN/com.stackarr.portless" 2>/dev/null || true
}

install_agent() {
    setup_launch_agent_paths

    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.stackarr.portless</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>WorkingDirectory</key>
  <string>$LAUNCH_APP_ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$STACKARR_BIN</string>
    <string>portless</string>
    <string>apply</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_ROOT/launchd/portless.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ROOT/launchd/portless.err.log</string>
</dict>
</plist>
EOF

    unload_agent
    load_agent
    ok "Installed Portless alias agent"
}

status_agent() {
    setup_launch_agent_paths
    launchctl print "$LAUNCH_DOMAIN/com.stackarr.portless" 2>/dev/null || warn "Portless alias agent is not loaded"
    portless list || true
}

truthy() {
    case "$(lowercase "${1:-}")" in
        1|true|yes|on)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

cmd="${1:-apply}"

case "$cmd" in
    apply)
        load_env
        load_browser_link_settings
        ensure_portless_path
        require_command portless

        tld="${STACKARR_SERVICE_URL_HOST_SUFFIX:-stack}"
        scheme="${STACKARR_SERVICE_URL_SCHEME:-https}"

        running_tld="$(active_portless_tld)"
        if [[ -n "$running_tld" && "$running_tld" != "$tld" ]]; then
            warn "Portless is running with the '.$running_tld' suffix; restarting it with the configured '.$tld' suffix."
            if ! portless proxy stop; then
                fail "Could not stop the existing Portless proxy. Run 'stackarr portless install' from a host terminal, then retry."
            fi
        fi

        print_header "Registering Stackarr Portless aliases"
        if [[ "${STACKARR_SERVICE_URL_MODE:-localhost}" != "portless" ]]; then
            warn "Dashboard service links are still set to '${STACKARR_SERVICE_URL_MODE:-localhost}'. Set Service Link Mode to portless in Settings > UI or Services > Stackarr > Browser Links."
        fi

        start_proxy "$tld" "$scheme"

        register_aliases
        prune_stale_stackarr_aliases

        if ! PORTLESS_TLD="$tld" portless hosts sync; then
            warn "Portless aliases were registered, but hosts sync failed. Clean names will not resolve until macOS host approval completes."
            host_install_hint
        fi
        ;;
    install)
        load_env
        load_browser_link_settings
        ensure_portless_installed
        install_agent
        "$ROOT_DIR/scripts/portless.sh" apply
        ;;
    status)
        load_env
        ensure_portless_path
        require_command portless
        status_agent
        ;;
    uninstall)
        load_env
        setup_launch_agent_paths
        unload_agent
        rm -f "$PLIST_PATH"
        ok "Removed Portless alias agent"
        ;;
    *)
        fail "Usage: stackarr portless apply|install|status|uninstall"
        ;;
esac
