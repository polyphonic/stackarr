#!/usr/bin/env python3
"""Provision the bounded Immich API key used by Stackarr health and app tools."""

from __future__ import annotations

import json
import os
import stat
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


base_url = env("IMMICH_URL", "http://127.0.0.1:2283").rstrip("/") + "/api"
email = env("IMMICH_ADMIN_EMAIL")
password = env("IMMICH_ADMIN_PASSWORD")
configured_key = env("IMMICH_API_KEY")
key_output = Path(env("IMMICH_API_KEY_OUTPUT"))
key_name = "Stackarr Agent"
permissions = [
    "job.read",
    "library.read",
    "library.update",
    "server.about",
    "server.statistics",
    "server.storage",
]


def request_json(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    expected: tuple[int, ...] = (200,),
) -> Any:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        base_url + path,
        data=body,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status not in expected:
                raise RuntimeError(f"Immich {method} {path} returned HTTP {response.status}")
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Immich {method} {path} returned HTTP {error.code}: {detail}") from error


def key_is_valid(api_key: str) -> bool:
    try:
        request_json("GET", "/server/about", headers={"x-api-key": api_key})
        return True
    except (OSError, RuntimeError, ValueError):
        return False


def save_key(api_key: str) -> None:
    if not key_output:
        raise SystemExit("IMMICH_API_KEY_OUTPUT is required")
    key_output.parent.mkdir(parents=True, exist_ok=True)
    key_output.write_text(api_key, encoding="utf-8")
    key_output.chmod(stat.S_IRUSR | stat.S_IWUSR)


if configured_key and key_is_valid(configured_key):
    save_key(configured_key)
    raise SystemExit(0)

if not email or not password:
    raise SystemExit("Immich owner email and password are required after first-run owner setup")

login = request_json("POST", "/auth/login", {"email": email, "password": password}, expected=(200, 201))
session_token = str((login or {}).get("accessToken") or "").strip()
if not session_token:
    raise SystemExit("Immich login did not return a session token")

session_headers = {"x-immich-user-token": session_token}
for item in request_json("GET", "/api-keys", headers=session_headers) or []:
    if item.get("name") != key_name or not item.get("id"):
        continue
    request_json("DELETE", f"/api-keys/{item['id']}", headers=session_headers, expected=(200, 204))

created = request_json(
    "POST",
    "/api-keys",
    {"name": key_name, "permissions": permissions},
    headers=session_headers,
    expected=(200, 201),
)
api_key = str((created or {}).get("secret") or "").strip()
if not api_key or not key_is_valid(api_key):
    raise SystemExit("Immich created an API key that could not be validated")

save_key(api_key)
