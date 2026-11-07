#!/usr/bin/env python3
"""Read only the current container start's bounded Servarr file-log tail."""

import datetime
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def current_start_log(path, started_at):
    start = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00")).timestamp()
    zone = ZoneInfo(os.environ.get("TZ", "Etc/UTC"))
    with Path(path).open("rb") as log:
        log.seek(0, 2)
        offset = max(0, log.tell() - 1024 * 1024)
        log.seek(offset)
        if offset:
            log.readline()  # Never interpret a partial first entry.
        lines = log.read().decode("utf-8", errors="replace").splitlines()
    include = False
    for line in lines:
        match = re.match(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?)\|", line)
        if match:
            # Fail closed if the timezone is unknown instead of silently
            # treating local file timestamps as UTC in a minimal image.
            include = datetime.datetime.fromisoformat(match[1]).replace(tzinfo=zone).timestamp() >= start
        if include:
            yield line


if __name__ == "__main__":
    try:
        print("\n".join(current_start_log(sys.argv[1], sys.argv[2])))
    except (OSError, ValueError, ZoneInfoNotFoundError):
        sys.exit(1)
