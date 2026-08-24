#!/usr/bin/env python3
"""Secure first-run Cleanuparr configuration for Stackarr-managed services."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, NoReturn

BASE_URL = os.environ.get("CLEANUPARR_URL", "http://127.0.0.1:11011").rstrip("/")
USERNAME = os.environ.get("USERNAME", "admin")
PASSWORD = os.environ.get("PASSWORD", "")
TORRENT_CLIENT = os.environ.get("PREFERRED_TORRENT_CLIENT", "transmission").lower()
CRON = os.environ.get("CLEANUPARR_MALWARE_CRON", "0/5 * * * * ?")
BLOCKLIST_CONTAINER_PATH = "/config/stackarr-malware-blocklist.txt"
MALWARE_PATTERNS = (
    "*.exe", "*.com", "*.scr", "*.pif", "*.cpl", "*.msi", "*.msp", "*.msu",
    "*.dll", "*.sys", "*.drv", "*.ocx", "*.ps1", "*.psm1", "*.psd1", "*.bat",
    "*.cmd", "*.hta", "*.vbs", "*.vbe", "*.js", "*.jse", "*.wsf", "*.wsh",
    "*.sh", "*.bash", "*.zsh", "*.ksh", "*.fish", "*.py", "*.pyc", "*.pyo",
    "*.rb", "*.pl", "*.php", "*.jar", "*.class", "*.apk", "*.app", "*.appimage",
    "*.dmg", "*.pkg", "*.deb", "*.rpm", "*.run", "*.elf", "*.so", "*.dylib",
    "*.lnk", "*.url", "*.desktop", "*.reg", "*.inf", "*.iso", "*.img", "*.vhd",
    "*.vhdx", "*.vmdk", "*.ova", "*.ovf", "*.docm", "*.dotm", "*.xlsm", "*.xlam",
    "*.pptm", "*.sldm",
)


def fail(message: str) -> NoReturn:
    print(f"Cleanuparr configuration failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    allowed: tuple[int, ...] = (200, 201, 204),
) -> tuple[int, Any]:
    url = f"{BASE_URL}{path}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            data = json.loads(raw.decode("utf-8")) if raw else None
            return response.status, data
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        if exc.code in allowed:
            try:
                return exc.code, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return exc.code, None
        detail = ""
        try:
            parsed = json.loads(raw)
            detail = parsed.get("detail") or parsed.get("title") or parsed.get("message") or ""
        except (json.JSONDecodeError, AttributeError):
            pass
        raise RuntimeError(f"{method} {path} returned HTTP {exc.code}{': ' + detail if detail else ''}") from exc


def wait_ready() -> dict[str, Any]:
    deadline = time.time() + 120
    last_error = "not ready"
    while time.time() < deadline:
        try:
            _, status = request("GET", "/api/auth/status")
            if isinstance(status, dict):
                return status
        except (OSError, RuntimeError) as exc:
            last_error = str(exc)
        time.sleep(2)
    fail(last_error)


def login() -> str:
    _, result = request("POST", "/api/auth/login", {"username": USERNAME, "password": PASSWORD})
    if not isinstance(result, dict):
        fail("login returned an invalid response")
    if result.get("requiresTwoFactor"):
        fail("two-factor authentication is enabled; configure integrations in the Cleanuparr UI")
    tokens = result.get("tokens") if isinstance(result.get("tokens"), dict) else result
    token = tokens.get("accessToken") if isinstance(tokens, dict) else None
    if not isinstance(token, str) or not token:
        fail("login did not return an access token")
    return token


def setup_account(status: dict[str, Any]) -> None:
    if status.get("setupCompleted"):
        return
    if not PASSWORD:
        fail("PASSWORD is required for first-run account setup")
    try:
        request("POST", "/api/auth/setup/account", {"username": USERNAME, "password": PASSWORD}, allowed=(201, 409))
    except RuntimeError as exc:
        if "409" not in str(exc):
            raise
    request("POST", "/api/auth/setup/complete", {}, allowed=(200, 409))


def items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        for key in ("items", "instances", "clients", "data", "results", "downloadClients"):
            if isinstance(value.get(key), list):
                return [item for item in value[key] if isinstance(item, dict)]
    return []


def arr_api_key(service: str) -> str:
    env_key = f"{service.upper()}_API_KEY"
    configured = os.environ.get(env_key, "").strip()
    if configured:
        return configured
    app_root = Path(os.environ.get("APP_ROOT", str(Path.home() / "Library/Application Support/Stackarr")))
    config_file = app_root / "config" / service / "config.xml"
    try:
        root = ET.parse(config_file).getroot()
        return (root.findtext("ApiKey") or "").strip()
    except (OSError, ET.ParseError):
        return ""


def write_malware_blocklist() -> None:
    app_root = Path(os.environ.get("APP_ROOT", str(Path.home() / "Library/Application Support/Stackarr")))
    path = app_root / "config" / "cleanuparr" / "stackarr-malware-blocklist.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "# Stackarr media-context executable and script denylist\n" + "\n".join(MALWARE_PATTERNS) + "\n"
    path.write_text(content, encoding="utf-8")
    path.chmod(0o644)


def upsert_download_client(token: str) -> None:
    if TORRENT_CLIENT in {"qbittorrent", "qbit", "qb"}:
        name = "qBittorrent"
        payload = {
            "enabled": True,
            "name": name,
            "typeName": "qBittorrent",
            "type": "Torrent",
            "host": f"http://qbittorrent:{os.environ.get('QBITTORRENT_WEBUI_PORT', '8081')}",
            "username": USERNAME,
            "password": os.environ.get("QBITTORRENT_PASSWORD", PASSWORD),
            "urlBase": "",
            "externalUrl": None,
            "downloadDirectorySource": "/downloads",
            "downloadDirectoryTarget": "/downloads",
        }
    else:
        name = "Transmission"
        payload = {
            "enabled": True,
            "name": name,
            "typeName": "Transmission",
            "type": "Torrent",
            "host": "http://transmission:9091",
            "username": USERNAME,
            "password": os.environ.get("TRANSMISSION_PASSWORD", PASSWORD),
            "urlBase": "/transmission/",
            "externalUrl": None,
            "downloadDirectorySource": "/downloads",
            "downloadDirectoryTarget": "/downloads",
        }
    _, current = request("GET", "/api/configuration/download_client", token=token)
    existing = next((item for item in items(current) if str(item.get("name", "")).lower() == name.lower()), None)
    if existing and existing.get("id"):
        request("PUT", f"/api/configuration/download_client/{existing['id']}", payload, token=token)
    else:
        request("POST", "/api/configuration/download_client", payload, token=token)


def upsert_arr(token: str, arr_type: str, name: str, url: str, api_key: str, version: float) -> None:
    if not api_key:
        return
    payload = {
        "enabled": True,
        "name": name,
        "url": url,
        "externalUrl": None,
        "apiKey": api_key,
        "version": version,
    }
    _, current = request("GET", f"/api/configuration/{arr_type}", token=token)
    existing = next((item for item in items(current) if str(item.get("name", "")).lower() == name.lower()), None)
    if existing and existing.get("id"):
        request("PUT", f"/api/configuration/{arr_type}/instances/{existing['id']}", payload, token=token)
    else:
        request("POST", f"/api/configuration/{arr_type}/instances", payload, token=token)


def configure_malware_blocker(token: str, enabled: dict[str, bool]) -> None:
    # Questarr uses the dedicated `games` category. ROM payloads commonly contain
    # legitimate disk images, so leave this category to Stackarr's fail-closed
    # ClamAV importer instead of Cleanuparr's media-oriented extension blocklist.
    ignored_downloads = ["games"] if os.environ.get("ENABLE_QUESTARR", "false").lower() == "true" else []
    payload: dict[str, Any] = {
        "enabled": any(enabled.values()),
        "cronExpression": CRON,
        "useAdvancedScheduling": True,
        "ignoredDownloads": ignored_downloads,
        "ignorePrivate": False,
        "deletePrivate": True,
        "processNoContentId": True,
        "deleteIfAnyFileBlocked": True,
    }
    for arr_type in ("sonarr", "radarr", "lidarr", "readarr", "whisparr"):
        payload[arr_type] = {
            "enabled": enabled.get(arr_type, False),
            "blocklistType": "Blacklist",
            "blocklistPath": BLOCKLIST_CONTAINER_PATH if enabled.get(arr_type, False) else "",
        }
    request("PUT", "/api/configuration/malware_blocker", payload, token=token)


def main() -> None:
    parsed = urllib.parse.urlparse(BASE_URL)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        fail("CLEANUPARR_URL must be an HTTP(S) URL")
    status = wait_ready()
    setup_account(status)
    token = login()
    write_malware_blocklist()
    keys = {service: arr_api_key(service) for service in ("radarr", "sonarr", "lidarr")}
    upsert_download_client(token)
    upsert_arr(token, "radarr", "Radarr", "http://radarr:7878", keys["radarr"], 3)
    upsert_arr(token, "sonarr", "Sonarr", "http://sonarr:8989", keys["sonarr"], 3)
    upsert_arr(token, "lidarr", "Lidarr", "http://lidarr:8686", keys["lidarr"], 1)
    configure_malware_blocker(token, {service: bool(key) for service, key in keys.items()})
    print("Cleanuparr secured: download client and Arr malware blocklists configured")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as exc:
        fail(str(exc))
