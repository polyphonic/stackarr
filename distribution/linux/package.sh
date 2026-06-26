#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/package-common.sh"

TARGET_ARCH="${1:-all}"
DIST_DIR="$STACKARR_DISTRIBUTION_DIR/linux/dist"

package_linux_arch() {
  local arch="$1"
  local name="Stackarr-linux-${arch}-${STACKARR_VERSION}"
  local stage="$DIST_DIR/$name"

  rm -rf "$stage"
  mkdir -p "$stage"
  stage_app_tree "$stage/Stackarr"

  cp "$SCRIPT_DIR/install.sh" "$stage/install.sh"
  chmod +x "$stage/install.sh"
  mkdir -p "$stage/systemd"
  cp "$SCRIPT_DIR/stackarr.service" "$stage/systemd/stackarr.service"

  cat >"$stage/README.txt" <<README
Stackarr ${STACKARR_VERSION} for Linux ${arch}

Run ./install.sh as root to install Stackarr to /opt/Stackarr with data in
/var/lib/stackarr, or run ./Stackarr/StackarrServer directly for a local user install.
README

  tar -C "$DIST_DIR" -czf "$DIST_DIR/$name.tar.gz" "$name"
  echo "$DIST_DIR/$name.tar.gz"
}

ensure_frontend_build
mkdir -p "$DIST_DIR"
package_arches "$TARGET_ARCH" package_linux_arch
