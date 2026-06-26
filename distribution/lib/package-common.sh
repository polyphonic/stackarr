#!/usr/bin/env bash
set -euo pipefail

STACKARR_DISTRIBUTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACKARR_ROOT_DIR="$(cd "$STACKARR_DISTRIBUTION_DIR/.." && pwd)"
STACKARR_VERSION="${STACKARR_VERSION:-$(node -e "console.log(require(process.argv[1]).version)" "$STACKARR_ROOT_DIR/package.json" 2>/dev/null || echo "0.0.0-dev")}"
STACKARR_DIST_DIR="$STACKARR_DISTRIBUTION_DIR/dist"

ensure_frontend_build() {
  if [[ "${STACKARR_SKIP_BUILD:-0}" == "1" ]]; then
    return
  fi

  if [[ -f "$STACKARR_ROOT_DIR/apps/frontend/.next/standalone/apps/frontend/server.js" ]]; then
    return
  fi

  pnpm --dir "$STACKARR_ROOT_DIR/apps/frontend" build
}

copy_tracked_paths() {
  local destination="$1"
  shift

  mkdir -p "$destination"

  (
    cd "$STACKARR_ROOT_DIR"
    git ls-files -z --cached --others --exclude-standard -- "$@" | while IFS= read -r -d '' file; do
      [[ -f "$file" ]] || continue
      mkdir -p "$destination/$(dirname "$file")"
      cp -p "$file" "$destination/$file"
    done
  )
}

copy_node_runtime() {
  local destination="$1"

  if [[ -z "${STACKARR_NODE_RUNTIME_DIR:-}" ]]; then
    return
  fi

  if [[ ! -d "$STACKARR_NODE_RUNTIME_DIR" ]]; then
    echo "STACKARR_NODE_RUNTIME_DIR does not exist: $STACKARR_NODE_RUNTIME_DIR" >&2
    exit 1
  fi

  mkdir -p "$destination/runtime"
  cp -R "$STACKARR_NODE_RUNTIME_DIR" "$destination/runtime/node"
}

write_posix_launchers() {
  local app_dir="$1"

  cat >"$app_dir/StackarrServer" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${STACKARR_DATA_DIR:-$HOME/.stackarr}"
OPEN_BROWSER=1

for arg in "$@"; do
  case "$arg" in
    -data=*)
      DATA_DIR="${arg#-data=}"
      ;;
    --data=*)
      DATA_DIR="${arg#--data=}"
      ;;
    -nobrowser|--no-browser)
      OPEN_BROWSER=0
      ;;
    "")
      ;;
    *)
      export STACKARR_REPO_ROOT="$APP_DIR"
      exec "$APP_DIR/bin/stackarr" "$@"
      ;;
  esac
done

NODE_BIN="$APP_DIR/runtime/node/bin/node"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Stackarr requires Node.js 20 or newer when a bundled Node runtime is not present." >&2
  exit 1
fi

export STACKARR_REPO_ROOT="$APP_DIR"
export STACKARR_DATA_DIR="$DATA_DIR"
export STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$DATA_DIR/config/stackarr.db}"
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="${NODE_OPTIONS:---disable-warning=ExperimentalWarning}"
export HOSTNAME="${STACKARR_BIND_HOST:-127.0.0.1}"
export PORT="${STACKARR_WEB_PORT:-7777}"

mkdir -p "$DATA_DIR/config"
cd "$APP_DIR"

if [[ "$OPEN_BROWSER" == "1" ]]; then
  (
    sleep 2
    url="http://127.0.0.1:${PORT}"
    if command -v open >/dev/null 2>&1; then
      open "$url"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$url"
    fi
  ) >/dev/null 2>&1 &
fi

exec "$NODE_BIN" apps/frontend/server.js
LAUNCHER
  chmod +x "$app_dir/StackarrServer"

  cat >"$app_dir/stackarr-cli" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export STACKARR_REPO_ROOT="$APP_DIR"
exec "$APP_DIR/bin/stackarr" "$@"
CLI
  chmod +x "$app_dir/stackarr-cli"
}

write_windows_launchers() {
  local app_dir="$1"

  cat >"$app_dir/Stackarr.cmd" <<'CMD'
@echo off
setlocal

set "APP_DIR=%~dp0"
set "NODE_EXE=%APP_DIR%runtime\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

if "%STACKARR_DATA_DIR%"=="" set "STACKARR_DATA_DIR=%LOCALAPPDATA%\Stackarr"
if "%STACKARR_DATABASE_FILE%"=="" set "STACKARR_DATABASE_FILE=%STACKARR_DATA_DIR%\config\stackarr.db"
if "%STACKARR_BIND_HOST%"=="" set "STACKARR_BIND_HOST=127.0.0.1"
if "%STACKARR_WEB_PORT%"=="" set "STACKARR_WEB_PORT=7777"
if "%NODE_OPTIONS%"=="" set "NODE_OPTIONS=--disable-warning=ExperimentalWarning"

set "STACKARR_REPO_ROOT=%APP_DIR%"
set "NODE_ENV=production"
set "NEXT_TELEMETRY_DISABLED=1"
set "HOSTNAME=%STACKARR_BIND_HOST%"
set "PORT=%STACKARR_WEB_PORT%"

if not exist "%STACKARR_DATA_DIR%\config" mkdir "%STACKARR_DATA_DIR%\config"
cd /d "%APP_DIR%"
"%NODE_EXE%" apps\frontend\server.js
CMD

  cat >"$app_dir/stackarr-cli.cmd" <<'CMD'
@echo off
setlocal

set "APP_DIR=%~dp0"
set "STACKARR_REPO_ROOT=%APP_DIR%"

bash "%APP_DIR%bin\stackarr" %*
CMD
}

stage_app_tree() {
  local app_dir="$1"
  local standalone_dir="$STACKARR_ROOT_DIR/apps/frontend/.next/standalone"

  if [[ ! -d "$standalone_dir" ]]; then
    echo "Missing Next.js standalone output. Run pnpm --dir apps/frontend build first." >&2
    exit 1
  fi

  rm -rf "$app_dir"
  mkdir -p "$app_dir"

  cp -R "$standalone_dir/." "$app_dir/"
  mkdir -p "$app_dir/apps/frontend/.next"
  cp -R "$STACKARR_ROOT_DIR/apps/frontend/.next/static" "$app_dir/apps/frontend/.next/static"
  cp -R "$STACKARR_ROOT_DIR/apps/frontend/public" "$app_dir/apps/frontend/public"

  local api_dir
  for api_dir in "$app_dir/apps/frontend/.next/server/app/api" "$app_dir/apps/frontend/src/app/api"; do
    if [[ -d "$api_dir" ]]; then
      find "$api_dir" -mindepth 1 -maxdepth 1 -type d ! -name v1 -exec rm -rf {} +
    fi
  done

  copy_tracked_paths "$app_dir" \
    Logo \
    bin \
    packages/agent-plugins \
    packages/cli \
    packages/core \
    packages/mcp \
    packages/ui \
    skills \
    stackarr

  copy_node_runtime "$app_dir"
  write_posix_launchers "$app_dir"
  write_windows_launchers "$app_dir"
}

package_arches() {
  local target_arch="$1"
  local callback="$2"

  case "$target_arch" in
    all)
      "$callback" arm64
      "$callback" x64
      ;;
    arm64|x64)
      "$callback" "$target_arch"
      ;;
    *)
      echo "Expected arch to be one of: all, arm64, x64" >&2
      exit 2
      ;;
  esac
}
