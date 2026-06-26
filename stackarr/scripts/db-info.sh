#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

load_env
print_header "Stackarr DB Info"

PLEX_LIBRARY_DB="$PLEX_CONFIG_PATH/Plug-in Support/Databases/com.plexapp.plugins.library.db"

cat <<EOF
Plex (native config dir):
  $PLEX_CONFIG_PATH
Plex preferences plist:
  $PLEX_PREFS_PATH

Likely SQLite database files:
  Plex library: sqlite://$PLEX_LIBRARY_DB
  Radarr:       sqlite://$CONFIG_ROOT/radarr/radarr.db
  Radarr 4K:    sqlite://$CONFIG_ROOT/radarr4k/radarr.db
  Sonarr:       sqlite://$CONFIG_ROOT/sonarr/sonarr.db
  Sonarr 4K:    sqlite://$CONFIG_ROOT/sonarr4k/sonarr.db
  Prowlarr:     sqlite://$CONFIG_ROOT/prowlarr/prowlarr.db
  Bazarr:       sqlite://$CONFIG_ROOT/bazarr/db/bazarr.db
  Lidarr:       sqlite://$CONFIG_ROOT/lidarr/lidarr.db

Shared Postgres databases:
  Host tools:   postgresql://$DATABASE_SUPERUSER@${DATABASE_BIND_IP:-127.0.0.1}:${DATABASE_HOST_PORT:-5433}/$DATABASE_NAME
  Service:      postgres://$DATABASE_SUPERUSER@database:5432/$DATABASE_NAME
  Stackarr main: postgres://$STACKARR_POSTGRES_USER@database:5432/$STACKARR_POSTGRES_DATABASE
  Stackarr log:  postgres://$STACKARR_POSTGRES_USER@database:5432/$STACKARR_POSTGRES_LOG_DATABASE
  BookOrbit:    postgres://$BOOKORBIT_POSTGRES_USER@database:5432/$BOOKORBIT_POSTGRES_DATABASE
  Seerr:        postgres://$SEERR_POSTGRES_USER@database:5432/$SEERR_POSTGRES_DATABASE
  Pulsarr:      postgres://$PULSARR_POSTGRES_USER@database:5432/$PULSARR_POSTGRES_DATABASE

Config roots:
  TinyMediaManager: $CONFIG_ROOT/tinymediamanager
  Transmission: $CONFIG_ROOT/transmission
  qBittorrent: $CONFIG_ROOT/qbittorrent
  Tidarr:       $CONFIG_ROOT/tidarr
EOF
