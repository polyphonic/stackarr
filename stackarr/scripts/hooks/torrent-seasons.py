#!/usr/bin/env python3
"""Classify a .torrent's complete video manifest: `single N`, `multi`, or `unknown`.

No tracker URL or metainfo content is emitted. Supports v1, v2, and hybrid
metainfo; invalid, unrecognized, or conflicting manifests fail closed.
Usage: python3 torrent-seasons.py /path/to/file.torrent
"""
import re
import sys
from pathlib import Path

MAX_SIZE = 32 * 1024 * 1024
VIDEO = {b".mkv", b".mp4", b".avi", b".m4v", b".mov", b".wmv", b".ts", b".webm"}
EPISODE = re.compile(rb"(?i)(?<![a-z0-9])s(\d{1,2})[ ._-]*e\d{1,3}(?!\d)")
SEASON = re.compile(rb"(?i)(?<![a-z0-9])season[ ._-]*(\d{1,2})(?!\d)")
SHORT_SEASON = re.compile(rb"(?i)(?<![a-z0-9])s(\d{1,2})(?![a-z0-9])")
X_EPISODE = re.compile(rb"(?i)(?<![a-z0-9])(\d{1,2})x\d{1,3}(?!\d)")


class Invalid(Exception):
    pass


def decode(data):
    pos = 0
    nodes = 0

    def item(depth):
        nonlocal pos, nodes
        nodes += 1
        if nodes > 200000 or depth > 64 or pos >= len(data):
            raise Invalid()
        kind = data[pos:pos + 1]
        pos += 1
        if kind == b"i":
            end = data.find(b"e", pos)
            if end < 0 or end - pos > 30:
                raise Invalid()
            value = data[pos:end]
            if not re.fullmatch(rb"(?:0|-[1-9]\d*|[1-9]\d*)", value):
                raise Invalid()
            pos = end + 1
            return int(value)
        if b"0" <= kind <= b"9":
            start = pos - 1
            end = data.find(b":", start)
            if end < 0 or end - start > 10:
                raise Invalid()
            digits = data[start:end]
            if not re.fullmatch(rb"(?:0|[1-9]\d*)", digits):
                raise Invalid()
            length = int(digits)
            pos = end + 1
            if length > len(data) - pos:
                raise Invalid()
            value = data[pos:pos + length]
            pos += length
            return value
        if kind == b"l":
            result = []
            while pos < len(data) and data[pos:pos + 1] != b"e":
                result.append(item(depth + 1))
            if pos == len(data):
                raise Invalid()
            pos += 1
            return result
        if kind == b"d":
            result = {}
            previous = None
            while pos < len(data) and data[pos:pos + 1] != b"e":
                key = item(depth + 1)
                if not isinstance(key, bytes) or (previous is not None and key <= previous):
                    raise Invalid()
                previous = key
                result[key] = item(depth + 1)
            if pos == len(data):
                raise Invalid()
            pos += 1
            return result
        raise Invalid()

    result = item(0)
    if pos != len(data):
        raise Invalid()
    return result


def valid_path(parts):
    if not isinstance(parts, (tuple, list)) or not parts or any(not isinstance(p, bytes) or not p or p in (b".", b"..") or
                        b"/" in p or b"\\" in p or b"\x00" in p for p in parts):
        raise Invalid()
    return tuple(parts)


def files(info):
    name = info.get(b"name.utf-8", info.get(b"name"))
    valid_path([name])
    v1 = None
    padding = set()
    if b"files" in info:
        entries = info[b"files"]
        if not isinstance(entries, list) or not entries:
            raise Invalid()
        v1 = []
        padding = set()
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get(b"length"), int) or entry[b"length"] < 0:
                raise Invalid()
            path = valid_path(entry.get(b"path.utf-8", entry.get(b"path")))
            attr = entry.get(b"attr", b"")
            if not isinstance(attr, bytes):
                raise Invalid()
            v1.append(path)
            if b"p" in attr:
                padding.add(path)
    elif b"length" in info:
        if not isinstance(info[b"length"], int) or info[b"length"] < 0:
            raise Invalid()
        v1 = [(name,)]
        padding = set()

    v2 = None
    if b"file tree" in info:
        tree = info[b"file tree"]
        v2 = []

        def walk(branch, prefix):
            if not isinstance(branch, dict) or not branch:
                raise Invalid()
            for key, value in branch.items():
                if key == b"":
                    if not prefix or not isinstance(value, dict) or not isinstance(value.get(b"length"), int) or value[b"length"] < 0:
                        raise Invalid()
                    attr = value.get(b"attr", b"")
                    if not isinstance(attr, bytes):
                        raise Invalid()
                    if b"p" not in attr:
                        v2.append(valid_path(prefix))
                else:
                    valid_path([key])
                    if b"" in branch or not isinstance(value, dict):
                        raise Invalid()
                    walk(value, prefix + (key,))

        walk(tree, ())
    version = info.get(b"meta version")
    if version == 2:
        if v2 is None or (v1 is not None and set(v1) - padding != set(v2)):
            raise Invalid()
        return v2
    if version is not None or v1 is None or v2 is not None:
        raise Invalid()
    return [path for path in v1 if path not in padding]


def classify(data, import_evidence=False):
    metainfo = decode(data)
    if not isinstance(metainfo, dict) or not isinstance(metainfo.get(b"info"), dict):
        raise Invalid()
    paths = files(metainfo[b"info"])
    seasons = set()
    video_count = 0
    total_videos = sum(Path(parts[-1].decode("utf-8", "surrogateescape")).suffix.lower().encode() in VIDEO for parts in paths)
    for parts in paths:
        if Path(parts[-1].decode("utf-8", "surrogateescape")).suffix.lower().encode() not in VIDEO:
            continue
        video_count += 1
        # Episode numbering wins over a redundant season directory, but disagreement
        # is ambiguous. Season-only path is sufficient for an unnumbered video.
        episode = {int(n) for n in EPISODE.findall(parts[-1])} | {int(n) for n in X_EPISODE.findall(parts[-1])}
        directory = {int(n) for p in parts[:-1] for n in SEASON.findall(p) + SHORT_SEASON.findall(p)}
        season_name = {int(n) for n in SEASON.findall(parts[-1])}
        candidates = episode | directory | season_name
        if len(candidates) > 1:
            return "unknown"
        if not candidates:
            # An unnumbered single video may be reconciled with Sonarr's import
            # evidence. A pack must never inherit a release/root folder guess.
            if import_evidence and total_videos == 1:
                return "one unknown"
            return "unknown"
        seasons.update(candidates)
    if not video_count or not seasons:
        return "unknown"
    return f"single {next(iter(seasons))}" if len(seasons) == 1 else "multi"


def main():
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--single-evidence"):
        return 2
    try:
        path = Path(sys.argv[1])
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SIZE:
            raise Invalid()
        result = classify(path.read_bytes(), len(sys.argv) == 3)
    except (Invalid, OSError, RecursionError, ValueError, TypeError):
        result = "unknown"
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
