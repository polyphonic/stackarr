#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$INSTALLER_DIR/Stackarr"
INSTALL_DIR="${STACKARR_INSTALL_DIR:-/opt/Stackarr}"
DATA_DIR="${STACKARR_DATA_DIR:-/var/lib/stackarr}"
RUN_USER="${STACKARR_RUN_USER:-stackarr}"
RUN_GROUP="${STACKARR_RUN_GROUP:-media}"
SERVICE_FILE="/etc/systemd/system/stackarr.service"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing packaged Stackarr app at $SOURCE_DIR" >&2
  exit 1
fi

case "$INSTALL_DIR" in
  ""|"/"|"/opt"|"/usr"|"/var"|"/var/lib")
    echo "Refusing to replace unsafe install directory: $INSTALL_DIR" >&2
    exit 1
    ;;
esac

if ! getent group "$RUN_GROUP" >/dev/null; then
  groupadd "$RUN_GROUP"
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin --gid "$RUN_GROUP" "$RUN_USER"
fi

systemctl stop stackarr.service >/dev/null 2>&1 || true

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -a "$SOURCE_DIR/." "$INSTALL_DIR/"
chown -R "$RUN_USER:$RUN_GROUP" "$DATA_DIR"
chmod 775 "$DATA_DIR"

if [[ ! -x "$INSTALL_DIR/runtime/node/bin/node" ]] && ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required when the package does not include a bundled Node runtime." >&2
  echo "Install Node.js or rebuild with STACKARR_NODE_RUNTIME_DIR pointing at an official Node runtime." >&2
  exit 1
fi

sed \
  -e "s|__STACKARR_USER__|$RUN_USER|g" \
  -e "s|__STACKARR_GROUP__|$RUN_GROUP|g" \
  -e "s|__STACKARR_INSTALL_DIR__|$INSTALL_DIR|g" \
  -e "s|__STACKARR_DATA_DIR__|$DATA_DIR|g" \
  "$INSTALLER_DIR/systemd/stackarr.service" >"$SERVICE_FILE"

systemctl daemon-reload
systemctl enable --now stackarr.service

echo "Stackarr is installed."
echo "Open http://127.0.0.1:7777/setup"
