#!/usr/bin/env python3
"""Reconcile Cleanuparr's local owner account with Stackarr's shared account."""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
import sqlite3
import subprocess
import sys


def fail(message: str) -> None:
    print(f"Cleanuparr credential sync skipped: {message}", file=sys.stderr)
    raise SystemExit(1)


def bcrypt_hash(password: str) -> str:
    if not password:
        fail("PASSWORD is empty")

    result = None
    try:
        result = subprocess.run(
            ["htpasswd", "-inBC", "12", ""],
            input=f"{password}\n",
            text=True,
            capture_output=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        fail("htpasswd is unavailable")

    if result is None:
        fail("htpasswd did not return a result")

    value = result.stdout.strip().partition(":")[2]
    if value.startswith("$2y$"):
        value = f"$2a${value[4:]}"
    if not value.startswith(("$2a$", "$2b$")):
        fail("htpasswd returned an unsupported bcrypt hash")
    return value


def sync_postgres(username: str, password_hash: str) -> None:
    database_password = os.environ.get("CLEANUPARR_POSTGRES_PASSWORD", "")
    database_user = os.environ.get("CLEANUPARR_POSTGRES_USER", "cleanuparr")
    database_name = os.environ.get("CLEANUPARR_POSTGRES_DATABASE", "cleanuparr")
    if not database_password:
        fail("CLEANUPARR_POSTGRES_PASSWORD is empty")

    sql = """\
BEGIN;
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM users.users) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one local owner';
  END IF;
END
$$;
UPDATE users.users
   SET username = :'stackarr_username',
       password_hash = :'stackarr_password_hash',
       failed_login_attempts = 0,
       lockout_end = NULL,
       updated_at = NOW();
DELETE FROM users.refresh_tokens;
COMMIT;
"""
    command = [
        "docker", "exec", "-i", "-e", "PGPASSWORD", "database",
        "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", database_user, "-d", database_name,
        "--set", f"stackarr_username={username}",
        "--set", f"stackarr_password_hash={password_hash}",
    ]
    environment = os.environ.copy()
    environment["PGPASSWORD"] = database_password
    try:
        subprocess.run(command, input=sql, text=True, capture_output=True, check=True, env=environment)
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", "").strip()
        fail(f"PostgreSQL user sync failed{(' : ' + detail) if detail else ''}")


def main() -> None:
    username = os.environ.get("USERNAME", "").strip()
    password = os.environ.get("PASSWORD", "")
    config_root = Path(os.environ.get("CONFIG_ROOT", "/stackarr-host-config"))
    database = Path(os.environ.get("CLEANUPARR_USERS_DB", config_root / "cleanuparr" / "users.db"))

    if not username:
        fail("USERNAME is empty")
    provider = os.environ.get("CLEANUPARR_DATABASE_PROVIDER", "sqlite").strip().lower()
    if provider != "postgres" and not database.is_file():
        fail(f"users database is missing at {database}")

    password_hash = bcrypt_hash(password)
    if provider == "postgres":
        sync_postgres(username, password_hash)
        print("Cleanuparr shared credentials synced")
        return

    now = dt.datetime.now(dt.UTC).isoformat()

    with sqlite3.connect(database, timeout=10) as connection:
        connection.execute("BEGIN IMMEDIATE")
        users = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if users != 1:
            connection.rollback()
            fail(f"expected one local owner, found {users}")
        connection.execute(
            """
            UPDATE users
               SET username = ?, password_hash = ?, failed_login_attempts = 0,
                   lockout_end = NULL, updated_at = ?
            """,
            (username, password_hash, now),
        )
        connection.execute("DELETE FROM refresh_tokens")
        connection.commit()

    print("Cleanuparr shared credentials synced")


if __name__ == "__main__":
    main()
