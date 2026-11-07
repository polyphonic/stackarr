#!/usr/bin/env python3
"""Kernel-backed exclusion for backup, PG sync and update commands.

The child inherits the lock's open file description, so it remains held even if
this supervisor is killed. Detached workers must acquire their own lock.
"""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main() -> int:
    args = sys.argv[2:]
    wait_seconds = 0
    if len(args) >= 2 and args[0] == "--wait":
        try:
            wait_seconds = int(args[1])
        except ValueError:
            return 2
        if not 0 <= wait_seconds <= 60:
            return 2
        args = args[2:]
    if len(args) < 2 or args[0] != "--":
        print("usage: maintenance-lock.py STATE_ROOT [--wait SECONDS] -- COMMAND [ARGS...]", file=sys.stderr)
        return 2
    command = args[1:]
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / "maintenance.lock"
    with lock_path.open("a+") as lock:
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    print("Stackarr maintenance already running", file=sys.stderr)
                    return 75
                time.sleep(0.1)
        # Bash reserves low descriptors for heredocs and process substitutions.
        # Duplicate above that range so shell children retain the lock handle.
        child_fd = fcntl.fcntl(lock.fileno(), fcntl.F_DUPFD, 100)
        env = os.environ.copy()
        env["STACKARR_MAINTENANCE_LOCK_FD"] = str(child_fd)
        child = subprocess.Popen(command, env=env, pass_fds=(child_fd,), start_new_session=True)
        os.close(child_fd)
        stopping = None

        def forward(sig, _frame):
            nonlocal stopping
            if stopping is None:
                stopping = time.monotonic()
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass

        signal.signal(signal.SIGTERM, forward)
        signal.signal(signal.SIGINT, forward)
        while True:
            try:
                result = child.wait(timeout=0.2)
                return 128 + (-result) if result < 0 else result
            except subprocess.TimeoutExpired:
                if stopping is not None and time.monotonic() - stopping > 20:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait()
                    return 143


if __name__ == "__main__":
    sys.exit(main())
