#!/bin/sh
# Validate complete metainfo and compare the digest of the untouched raw info span.
set -eu
[ "$#" -eq 2 ] || exit 1
file=$1
expected=$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')
if [ "$expected" != '-' ]; then
    case "$expected" in *[!0-9A-F]*|'') exit 1 ;; esac
    case ${#expected} in 40|64) ;; *) exit 1 ;; esac
fi
[ -f "$file" ] && [ ! -L "$file" ] || exit 1
size=$(wc -c < "$file" | tr -d ' ')
[ "$size" -gt 0 ] && [ "$size" -le 33554432 ] || exit 1
script=$(dirname "$0")/torrent-verify.awk
[ -f "$script" ] && [ ! -L "$script" ] || exit 1
span=$(LC_ALL=C od -An -v -tu1 "$file" | LC_ALL=C awk -f "$script") || exit 1
set -- $span
[ "$#" -eq 2 ] || exit 1
[ "$expected" != '-' ] || exit 0
case "$expected" in
    ????????????????????????????????????????) digest=sha1sum ;;
    *) digest=sha256sum ;;
esac
actual=$(dd if="$file" bs=1 skip="$1" count="$2" 2>/dev/null | "$digest") || exit 1
actual=${actual%% *}
[ "$(printf '%s' "$actual" | tr '[:lower:]' '[:upper:]')" = "$expected" ]
