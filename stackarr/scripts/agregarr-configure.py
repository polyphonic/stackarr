#!/usr/bin/env python3
"""Idempotently connect Agregarr to a Stackarr-managed Plex and Arr stack."""

from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def enabled(name: str) -> bool:
    return env(name).lower() in {"1", "true", "yes", "on"}


def folder_name(name: str, default: str) -> str:
    value = env(name, default)
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise SystemExit(f"{name} must be a single folder name")
    return value


base_url = env("AGREGARR_URL", "http://127.0.0.1:7171").rstrip("/") + "/api/v1"
settings_path = Path(env("AGREGARR_SETTINGS_PATH"))
key_output = Path(env("AGREGARR_KEY_OUTPUT"))
plex_token = env("PLEX_TOKEN")
placeholder_folder = folder_name("AGREGARR_PLACEHOLDER_FOLDER", "_Trailers")

if not settings_path.is_file():
    raise SystemExit(f"Agregarr settings are not ready at {settings_path}")

api_key = str(json.loads(settings_path.read_text(encoding="utf-8")).get("main", {}).get("apiKey", "")).strip()
if not api_key:
    raise SystemExit("Agregarr did not generate an API key")
if not plex_token:
    raise SystemExit("A Plex owner token is required to initialize Agregarr")

cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def request(path: str, *, method: str = "GET", body: Any = None, authenticated: bool = True) -> Any:
    headers = {"Accept": "application/json"}
    if authenticated:
        headers["X-Api-Key"] = api_key
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Agregarr {method} {path} failed with HTTP {error.code}: {detail}") from error


def choose(items: list[dict[str, Any]], desired: str, fallback_key: str) -> dict[str, Any]:
    return next((item for item in items if str(item.get("name", "")).lower() == desired.lower()), None) or next(
        (item for item in items if item.get(fallback_key)), None
    ) or (items[0] if items else {})


def configure_servarr(kind: str, api_key_value: str, desired_profile: str, directory: str) -> None:
    if not api_key_value:
        return

    port = 7878 if kind == "radarr" else 8989
    test_payload = {
        "hostname": kind,
        "port": port,
        "apiKey": api_key_value,
        "useSsl": False,
        "baseUrl": "",
    }
    tested = request(f"/settings/{kind}/test", method="POST", body=test_payload)
    profiles = tested.get("profiles", []) if isinstance(tested, dict) else []
    folders = tested.get("rootFolders", tested.get("rootfolders", [])) if isinstance(tested, dict) else []
    profile = choose(profiles, desired_profile, "id")
    folder = next((item for item in folders if item.get("path") == directory), None) or (folders[0] if folders else {})
    if not profile.get("id") or not folder.get("path"):
        raise RuntimeError(f"Agregarr could not resolve a {kind.title()} quality profile and root folder")

    payload: dict[str, Any] = {
        **test_payload,
        "name": kind.title(),
        "activeProfileId": profile["id"],
        "activeProfileName": profile.get("name", desired_profile),
        "activeDirectory": folder["path"],
        "isDefault": True,
        "is4k": False,
        "externalUrl": f"http://127.0.0.1:{port}",
        "monitorByDefault": False,
        "searchOnAdd": False,
        "tagRequests": False,
        "tagRequestsMode": "off",
        "tagExistingItems": False,
        "tags": [],
    }
    if kind == "radarr":
        payload["minimumAvailability"] = "announced"
    else:
        payload.update({"enableSeasonFolders": True, "seriesType": "standard", "monitorType": "none"})

    existing = request(f"/settings/{kind}")
    current = existing[0] if isinstance(existing, list) and existing else None
    if current and current.get("id") is not None:
        request(f"/settings/{kind}/{current['id']}", method="PUT", body=payload)
    else:
        request(f"/settings/{kind}", method="POST", body=payload)


def coming_soon_payload(libraries: list[dict[str, Any]]) -> dict[str, Any]:
    media_types = {"movie" if library.get("type") == "movie" else "tv" for library in libraries}
    both = media_types == {"movie", "tv"}
    payload: dict[str, Any] = {
        "id": "",
        "name": "Coming Soon",
        "type": "comingsoon",
        "subtype": "monitored",
        "template": "Coming Soon",
        "visibilityConfig": {"usersHome": True, "serverOwnerHome": True, "libraryRecommended": True},
        "maxItems": 100,
        "mediaType": "both" if both else next(iter(media_types)),
        "sortOrderHome": 2,
        "sortOrderLibrary": 1,
        "isLibraryPromoted": True,
        "randomizeHomeOrder": False,
        "sortOrder": "release_date_asc",
        "createPlaceholdersForMissing": True,
        "placeholderDaysAhead": 730,
        "placeholderReleasedDays": 14,
        "applyOverlaysDuringSync": True,
        "autoPoster": False,
    }
    if both:
        payload.update(
            {
                "libraryIds": [library_key(library) for library in libraries],
                "libraryNames": [str(library["name"]) for library in libraries],
                "customMovieTemplate": "Coming Soon",
                "customTVTemplate": "Coming Soon",
            }
        )
    else:
        payload.update({"libraryId": library_key(libraries[0]), "libraryName": str(libraries[0]["name"])})
    return payload


def library_key(library: dict[str, Any]) -> str:
    return str(library.get("key") or library.get("id") or "")


def configure_coming_soon(libraries: list[dict[str, Any]]) -> list[str]:
    response = request("/collections")
    existing = response.get("collectionConfigs", []) if isinstance(response, dict) else []
    desired_ids = {library_key(library) for library in libraries}
    matches = [
        item
        for item in existing
        if item.get("type") == "comingsoon"
        and item.get("subtype") == "monitored"
        and str(item.get("libraryId")) in desired_ids
    ]
    existing_ids = {str(item.get("libraryId")) for item in matches}
    missing = [library for library in libraries if library_key(library) not in existing_ids]
    if missing:
        request("/collections/create", method="POST", body=coming_soon_payload(missing))
        response = request("/collections")
        existing = response.get("collectionConfigs", []) if isinstance(response, dict) else []
        matches = [
            item
            for item in existing
            if item.get("type") == "comingsoon"
            and item.get("subtype") == "monitored"
            and str(item.get("libraryId")) in desired_ids
        ]

    for item in matches:
        updated = {
            **item,
            "maxItems": max(100, int(item.get("maxItems") or 0)),
            "sortOrder": "release_date_asc",
            "createPlaceholdersForMissing": True,
            "placeholderDaysAhead": max(730, int(item.get("placeholderDaysAhead") or 0)),
            "placeholderReleasedDays": int(item.get("placeholderReleasedDays") or 14),
            "randomizeHomeOrder": False,
            "visibilityConfig": {
                **(item.get("visibilityConfig") or {}),
                "usersHome": True,
                "serverOwnerHome": True,
                "libraryRecommended": True,
            },
        }
        request(f"/collections/{item['id']}/settings", method="PUT", body=updated)

    return [str(item["id"]) for item in matches]


FILTERED_HUB_SUBTYPES = {
    "movie.recentlyadded": "recently_added",
    "movie.recentlyreleased": "recently_released",
    "tv.recentlyadded": "recently_added",
    "tv.recentlyaired": "recently_released_episodes",
}


def configure_filtered_hubs(libraries: list[dict[str, Any]]) -> list[str]:
    """Replace visible Plex hubs that can expose trailer placeholders."""
    # This is the same native discovery sequence used by Agregarr's UI. The
    # scan also saves newly discovered default hubs, so fresh installs do not
    # need a manual "Discover Existing Collections & Hubs" step first.
    request("/settings/plex/library?sync=true")
    request("/discovery/hubs/scan")

    enabled_library_ids = {library_key(library) for library in libraries}
    collection_response = request("/collections")
    collection_configs = (
        collection_response.get("collectionConfigs", []) if isinstance(collection_response, dict) else []
    )
    default_hubs = request("/defaulthubs")
    filtered_ids: list[str] = []

    for hub in default_hubs if isinstance(default_hubs, list) else []:
        library_id = str(hub.get("libraryId") or "")
        subtype = FILTERED_HUB_SUBTYPES.get(str(hub.get("hubIdentifier") or ""))
        visibility = dict(hub.get("visibilityConfig") or {})
        is_visible = any(
            visibility.get(key) is True for key in ("usersHome", "serverOwnerHome", "libraryRecommended")
        )
        if library_id not in enabled_library_ids or not subtype or not is_visible:
            continue

        existing = next(
            (
                item
                for item in collection_configs
                if item.get("type") == "filtered_hub"
                and item.get("subtype") == subtype
                and str(item.get("libraryId") or "") == library_id
            ),
            None,
        )
        if existing is None:
            created = request(
                "/collections/create",
                method="POST",
                body={
                    "id": "",
                    "name": str(hub.get("name") or "Recently Released"),
                    "type": "filtered_hub",
                    "subtype": subtype,
                    "template": str(hub.get("name") or "Recently Released"),
                    "visibilityConfig": {
                        "usersHome": visibility.get("usersHome") is True,
                        "serverOwnerHome": visibility.get("serverOwnerHome") is True,
                        "libraryRecommended": visibility.get("libraryRecommended") is True,
                    },
                    "maxItems": 20,
                    "mediaType": "tv" if str(hub.get("mediaType")) == "tv" else "movie",
                    "libraryId": library_id,
                    "libraryName": str(hub.get("libraryName") or ""),
                    "sortOrderHome": int(hub.get("sortOrderHome") or 0),
                    "sortOrderLibrary": int(hub.get("sortOrderLibrary") or 0),
                    "randomizeHomeOrder": False,
                    "autoPoster": False,
                },
            )
            created_configs = created.get("collectionConfigs", []) if isinstance(created, dict) else []
            existing = created_configs[0] if created_configs else None
            if existing:
                collection_configs.append(existing)

        if existing and existing.get("id") is not None:
            filtered_ids.append(str(existing["id"]))

        request(
            f"/defaulthubs/{hub['id']}/settings",
            method="PUT",
            body={
                **hub,
                "visibilityConfig": {
                    **visibility,
                    "usersHome": False,
                    "serverOwnerHome": False,
                    "libraryRecommended": False,
                },
            },
        )

    return filtered_ids


# Create or refresh the owner through Agregarr's supported Plex-token endpoint.
request("/auth/plex", method="POST", body={"authToken": plex_token}, authenticated=False)

plex_settings = request("/settings/plex")
request(
    "/settings/plex",
    method="POST",
    body={
        "ip": env("AGREGARR_PLEX_HOST", "host.docker.internal"),
        "port": int(env("AGREGARR_PLEX_PORT", "32400")),
        "useSsl": False,
        "webAppUrl": plex_settings.get("webAppUrl") or "https://app.plex.tv/desktop",
        "autoEmptyTrash": plex_settings.get("autoEmptyTrash", True),
    },
)

request(
    "/settings/main",
    method="POST",
    body={
        "applicationUrl": env("AGREGARR_BROWSER_URL", env("AGREGARR_URL")),
        "localLogin": False,
        "newPlexLogin": False,
    },
)

configure_servarr("radarr", env("RADARR_API_KEY"), env("RADARR_DEFAULT_PROFILE", "HD Lite"), "/movies")
configure_servarr("sonarr", env("SONARR_API_KEY"), env("SONARR_DEFAULT_PROFILE", "HD Lite"), "/tv")

available_libraries = request("/settings/plex/libraries")
libraries = [
    library
    for library in available_libraries
    if (library.get("type") == "movie" and enabled("ENABLE_MOVIES"))
    or (library.get("type") == "show" and enabled("ENABLE_TV_SHOWS"))
]
if not libraries:
    raise RuntimeError("Agregarr could not find an enabled Plex movie or TV library")

# Keep Agregarr's trailer-backed placeholders inside each Plex library but out
# of the actual Arr-managed title folders. If placeholders share /movies or
# /tv directly, Radarr/Sonarr can import the trailers as downloaded media and
# the next Coming Soon sync will incorrectly exclude those titles.
main_settings = request("/settings/main")
movie_placeholder_roots = dict(main_settings.get("placeholderMovieRootFolders") or {})
tv_placeholder_roots = dict(main_settings.get("placeholderTVRootFolders") or {})
for library in libraries:
    if library.get("type") == "movie":
        movie_placeholder_roots[library_key(library)] = f"/movies/{placeholder_folder}"
    elif library.get("type") == "show":
        tv_placeholder_roots[library_key(library)] = f"/tv/{placeholder_folder}"

request(
    "/settings/main",
    method="POST",
    body={
        "placeholderMovieRootFolders": movie_placeholder_roots,
        "placeholderTVRootFolders": tv_placeholder_roots,
    },
)

collection_ids = configure_coming_soon(libraries)
request("/settings/initialize", method="POST")
filtered_hub_ids = configure_filtered_hubs(libraries)
# One full job applies the new collection configs and the disabled default-hub
# visibility together. Starting individual syncs immediately before this job
# can make two placeholder workers download the same trailer concurrently.
request("/settings/jobs/plex-collections-sync/run", method="POST")

key_output.write_text(api_key, encoding="utf-8")
key_output.chmod(0o600)
print(
    f"Agregarr initialized with {len(libraries)} Plex libraries, "
    f"{len(collection_ids)} Coming Soon collections, and {len(filtered_hub_ids)} filtered hubs"
)
