#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/package-common.sh"

TARGET_ARCH="${1:-all}"
DIST_DIR="$STACKARR_DISTRIBUTION_DIR/macos/dist"

create_macos_icon() {
  local resources_dir="$1"
  local source_icon="$STACKARR_ROOT_DIR/Logo/stackarr-512.png"
  local iconset="$resources_dir/Stackarr.iconset"

  [[ -f "$source_icon" ]] || return 0
  command -v sips >/dev/null 2>&1 || return 0
  command -v iconutil >/dev/null 2>&1 || return 0

  rm -rf "$iconset"
  mkdir -p "$iconset"
  sips -z 16 16 "$source_icon" --out "$iconset/icon_16x16.png" >/dev/null
  sips -z 32 32 "$source_icon" --out "$iconset/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$source_icon" --out "$iconset/icon_32x32.png" >/dev/null
  sips -z 64 64 "$source_icon" --out "$iconset/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$source_icon" --out "$iconset/icon_128x128.png" >/dev/null
  sips -z 256 256 "$source_icon" --out "$iconset/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$source_icon" --out "$iconset/icon_256x256.png" >/dev/null
  sips -z 512 512 "$source_icon" --out "$iconset/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$source_icon" --out "$iconset/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$source_icon" --out "$iconset/icon_512x512@2x.png" >/dev/null
  if ! iconutil -c icns "$iconset" -o "$resources_dir/Stackarr.icns" >/dev/null 2>&1; then
    sips -s format icns "$source_icon" --out "$resources_dir/Stackarr.icns" >/dev/null
  fi
  rm -rf "$iconset"
}

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

APP_BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$APP_BUNDLE/Contents/Resources/app"
export STACKARR_APP_BUNDLE="$APP_BUNDLE"
export STACKARR_CLI_BIN="$APP_BUNDLE/Contents/MacOS/Stackarr"
export STACKARR_DATA_DIR="${STACKARR_DATA_DIR:-$HOME/Library/Application Support/Stackarr}"
export STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$STACKARR_DATA_DIR/config/stackarr.db}"
exec "$APP_DIR/StackarrServer" "$@"
LAUNCHER
  chmod +x "$stage/Stackarr.app/Contents/MacOS/Stackarr"

cat >"$stage/stackarr" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/Stackarr.app" && pwd)"
APP_DIR="$APP_BUNDLE/Contents/Resources/app"
export STACKARR_APP_BUNDLE="$APP_BUNDLE"
export STACKARR_CLI_BIN="$APP_BUNDLE/Contents/MacOS/Stackarr"
export STACKARR_DATA_DIR="${STACKARR_DATA_DIR:-$HOME/Library/Application Support/Stackarr}"
export STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$STACKARR_DATA_DIR/config/stackarr.db}"
exec "$APP_DIR/stackarr-cli" "$@"
CLI
  chmod +x "$stage/stackarr"

  create_macos_icon "$stage/Stackarr.app/Contents/Resources"

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
  <key>CFBundleIconFile</key>
  <string>Stackarr</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${STACKARR_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${STACKARR_VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.utilities</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$stage/Stackarr.app" >/dev/null 2>&1 || true
  fi

  tar -C "$DIST_DIR" -czf "$DIST_DIR/$name.tar.gz" "$name"
  echo "$DIST_DIR/$name.tar.gz"
}

ensure_frontend_build
mkdir -p "$DIST_DIR"
package_arches "$TARGET_ARCH" package_macos_arch
