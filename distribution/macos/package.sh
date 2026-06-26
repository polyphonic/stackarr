#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/package-common.sh"

TARGET_ARCH="${1:-all}"
DIST_DIR="$STACKARR_DISTRIBUTION_DIR/macos/dist"

package_macos_arch() {
  local arch="$1"
  local name="Stackarr-macos-${arch}-${STACKARR_VERSION}"
  local stage="$DIST_DIR/$name"
  local app_resources="$stage/Stackarr.app/Contents/Resources/app"

  rm -rf "$stage"
  mkdir -p "$stage/Stackarr.app/Contents/MacOS" "$stage/Stackarr.app/Contents/Resources"
  stage_app_tree "$app_resources"

  cat >"$stage/Stackarr.app/Contents/MacOS/Stackarr" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Resources/app" && pwd)"
exec "$APP_DIR/StackarrServer" "$@"
LAUNCHER
  chmod +x "$stage/Stackarr.app/Contents/MacOS/Stackarr"

  cat >"$stage/Stackarr.app/Contents/MacOS/stackarr" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Resources/app" && pwd)"
exec "$APP_DIR/stackarr-cli" "$@"
CLI
  chmod +x "$stage/Stackarr.app/Contents/MacOS/stackarr"

  cat >"$stage/stackarr" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/Stackarr.app/Contents/Resources/app" && pwd)"
exec "$APP_DIR/stackarr-cli" "$@"
CLI
  chmod +x "$stage/stackarr"

  cat >"$stage/Stackarr.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Stackarr</string>
  <key>CFBundleIdentifier</key>
  <string>com.polyphonic.stackarr</string>
  <key>CFBundleName</key>
  <string>Stackarr</string>
  <key>CFBundleDisplayName</key>
  <string>Stackarr</string>
  <key>CFBundleShortVersionString</key>
  <string>${STACKARR_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${STACKARR_VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
PLIST

  tar -C "$DIST_DIR" -czf "$DIST_DIR/$name.tar.gz" "$name"
  echo "$DIST_DIR/$name.tar.gz"
}

ensure_frontend_build
mkdir -p "$DIST_DIR"
package_arches "$TARGET_ARCH" package_macos_arch
