#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/lib/common.sh"
load_env

configure_tdarr() {
    optional_service_enabled tdarr || { warn "Tdarr is disabled"; return 0; }
    TDARR_API_URL="$(service_url tdarr "$TDARR_API_URL" 8266)" python3 - <<'PY'
import json, os, urllib.request, urllib.error
base = os.environ['TDARR_API_URL'].rstrip('/')
def request(path, body=None):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers={'content-type': 'application/json', 'x-api-key': os.environ.get('TDARR_API_KEY', '')})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, None
status, data = request('/api/v2/status')
if status != 200:
    raise SystemExit('Tdarr API is not ready; apply the service and retry configure.')
if os.environ.get('TDARR_AUTH', 'true') != 'false':
    credentials = {'username': os.environ.get('USERNAME', ''), 'password': os.environ.get('PASSWORD', '')}
    if not all(credentials.values()):
        raise SystemExit('Shared Stackarr credentials are required for Tdarr first-run setup.')
    login, _ = request('/api/v2/public/auth/login', credentials)
    if login == 401:
        registered, _ = request('/api/v2/public/auth/register', credentials)
        if registered == 403:
            print('Tdarr already has an account; existing credentials were preserved.')
        elif registered != 201:
            raise SystemExit('Tdarr first-account registration failed.')
        else:
            login, _ = request('/api/v2/public/auth/login', credentials)
            if login != 200: raise SystemExit('Tdarr account was created but login verification failed.')
            print('Tdarr first account created and login verified with shared Stackarr credentials.')
    elif login != 200:
        raise SystemExit('Tdarr login check failed.')
    else:
        print('Tdarr login verified; existing account preserved.')
status, nodes = request('/api/v2/get-nodes')
if status != 200: raise SystemExit('Tdarr API key verification failed.')
print('Tdarr API authenticated; connected nodes:', len(nodes))
print('Media is available at /media; transcode cache is /temp. Existing library settings are preserved.')
PY
}

case "${1:-help}" in
    status)
        if optional_service_enabled tdarr; then ok "Tdarr is enabled"; else warn "Tdarr is disabled"; fi
        printf 'URL: %s\nMedia: %s -> /media\nCache: %s -> /temp\n' "$TDARR_URL" "$TDARR_MEDIA_ROOT" "$TDARR_CACHE_ROOT"
        stackarr_compose --profile tdarr ps tdarr
        ;;
    url) printf '%s\n' "$TDARR_URL" ;;
    open)
        if [[ "$(uname -s)" == Darwin ]]; then open "$TDARR_URL"; else printf '%s\n' "$TDARR_URL"; fi
        ;;
    enable|disable)
        enabled=false
        [[ "$1" == enable ]] && enabled=true
        set_env_value ENABLE_TDARR "$enabled"
        write_compose_env_file
        ok "Tdarr setting saved; run 'stackarr tdarr apply' to apply it."
        ;;
    apply) exec "$ROOT_DIR/scripts/service-apply.sh" apply tdarr ;;
    configure) configure_tdarr ;;
    help|--help|-h) printf 'Usage: stackarr tdarr status|url|open|enable|disable|apply|configure\n' ;;
    *) exit 1 ;;
esac
