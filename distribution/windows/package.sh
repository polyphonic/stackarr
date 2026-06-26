#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/package-common.sh"

TARGET_ARCH="${1:-all}"
DIST_DIR="$STACKARR_DISTRIBUTION_DIR/windows/dist"

package_windows_arch() {
  local arch="$1"
  local name="Stackarr-windows-${arch}-${STACKARR_VERSION}"
  local stage="$DIST_DIR/$name"

  rm -rf "$stage"
  mkdir -p "$stage/setup"
  stage_app_tree "$stage/Stackarr"

  cp "$SCRIPT_DIR/setup/stackarr.iss" "$stage/setup/stackarr.iss"
  cp "$SCRIPT_DIR/setup/build.bat" "$stage/setup/build.bat"
  printf "%s\n" "$STACKARR_VERSION" >"$stage/VERSION.txt"

  if command -v zip >/dev/null 2>&1; then
    rm -f "$DIST_DIR/$name.zip"
    (cd "$DIST_DIR" && zip -qr "$name.zip" "$name")
    echo "$DIST_DIR/$name.zip"
  else
    tar -C "$DIST_DIR" -czf "$DIST_DIR/$name.tar.gz" "$name"
    echo "$DIST_DIR/$name.tar.gz"
  fi
}

ensure_frontend_build
mkdir -p "$DIST_DIR"
package_arches "$TARGET_ARCH" package_windows_arch
