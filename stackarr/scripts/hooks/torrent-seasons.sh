#!/bin/sh
# Zero-install metainfo classifier. No temporary files or metainfo output.
# Usage: torrent-seasons.sh FILE [--single-evidence]
case $# in 1|2) ;; *) exit 2 ;; esac
if [ "$#" -eq 2 ] && [ "$2" != '--single-evidence' ]; then exit 2; fi
file=$1
LC_ALL=C
export LC_ALL
script=$(dirname "$0")/torrent-seasons.awk
if [ ! -f "$file" ] || [ -L "$file" ] || [ ! -r "$file" ] || [ ! -r "$script" ]; then
    printf '%s\n' unknown
    exit 0
fi
size=$(wc -c < "$file" 2>/dev/null | tr -d '[:space:]') || size=''
case $size in ''|*[!0-9]*) printf '%s\n' unknown; exit 0 ;; esac
if [ "$size" -gt 33554432 ]; then printf '%s\n' unknown; exit 0; fi
# awk reads at most one od record at a time. The 32 MiB cap is checked before od.
if [ "$#" -eq 2 ]; then
    od -An -v -tu1 "$file" 2>/dev/null | awk -v evidence=1 -f "$script"
else
    od -An -v -tu1 "$file" 2>/dev/null | awk -f "$script"
fi
