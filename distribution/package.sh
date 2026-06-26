#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/distribution/lib/package-common.sh"

TARGET="${1:-all}"
TARGET_ARCH="${2:-all}"

usage() {
  echo "Usage: distribution/package.sh [all|macos|linux|windows] [all|arm64|x64]" >&2
}

case "$TARGET" in
  all|macos|linux|windows)
    ;;
  *)
    usage
    exit 2
    ;;
esac

ensure_frontend_build

if [[ "$TARGET" == "all" || "$TARGET" == "macos" ]]; then
  STACKARR_SKIP_BUILD=1 "$ROOT_DIR/distribution/macos/package.sh" "$TARGET_ARCH"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "linux" ]]; then
  STACKARR_SKIP_BUILD=1 "$ROOT_DIR/distribution/linux/package.sh" "$TARGET_ARCH"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "windows" ]]; then
  STACKARR_SKIP_BUILD=1 "$ROOT_DIR/distribution/windows/package.sh" "$TARGET_ARCH"
fi
