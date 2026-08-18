#!/usr/bin/env python3
"""Idempotently connect Agregarr to a Stackarr-managed Plex and Arr stack."""

from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
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


def read_season_folders_enabled() -> bool:
    default_path = Path(__file__).resolve().parent.parent / "config/naming.json"
    naming_path = Path(env("STACKARR_NAMING_CONFIG_FILE", str(default_path)))
    try:
        naming = json.loads(naming_path.read_text(encoding="utf-8"))
        return bool((naming.get("tv") or {}).get("seasonFolders", True))
    except (OSError, ValueError, TypeError):
        return True


base_url = env("AGREGARR_URL", "http://127.0.0.1:7171").rstrip("/") + "/api/v1"
plex_url = env("PLEX_URL", "http://127.0.0.1:32400").rstrip("/")
settings_path = Path(env("AGREGARR_SETTINGS_PATH"))
key_output = Path(env("AGREGARR_KEY_OUTPUT"))
plex_token = env("PLEX_TOKEN")
placeholder_folder = folder_name("AGREGARR_PLACEHOLDER_FOLDER", "_Trailers")
season_folders_enabled = read_season_folders_enabled()

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


def plex_collection_metadata(rating_key: str) -> dict[str, str]:
    metadata_query = urllib.parse.urlencode({"X-Plex-Token": plex_token})
    metadata_request = urllib.request.Request(f"{plex_url}/library/metadata/{rating_key}?{metadata_query}")
    try:
        with urllib.request.urlopen(metadata_request, timeout=30) as response:
            metadata_root = ET.fromstring(response.read())
    except (urllib.error.URLError, ET.ParseError) as error:
        raise RuntimeError("Plex collection metadata could not be read") from error
    metadata = next(iter(metadata_root), None)
    return dict(metadata.attrib) if metadata is not None else {}


def plex_collection_title(rating_key: str) -> str:
    return plex_collection_metadata(rating_key).get("title", "")


def plex_mutation(path: str, method: str, description: str, *, allow_not_found: bool = False) -> None:
    separator = "&" if "?" in path else "?"
    token_query = urllib.parse.urlencode({"X-Plex-Token": plex_token})
    mutation_request = urllib.request.Request(f"{plex_url}{path}{separator}{token_query}", method=method)
    try:
        with urllib.request.urlopen(mutation_request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        if allow_not_found and error.code == 404:
            return
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"{description} failed with HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"{description} could not reach the Plex server") from error


def refresh_plex_collection_hub(library_id: str, rating_key: str) -> None:
    """Recreate a promoted hub so Plex drops a legacy cached collection title."""
    encoded_library = urllib.parse.quote(library_id, safe="")
    encoded_rating_key = urllib.parse.quote(rating_key, safe="")
    identifier = f"custom.collection.{encoded_library}.{encoded_rating_key}"
    plex_mutation(
        f"/hubs/sections/{encoded_library}/manage/{identifier}",
        "DELETE",
        "Plex collection hub refresh",
        allow_not_found=True,
    )
    plex_mutation(
        f"/hubs/sections/{encoded_library}/manage?metadataItemId={encoded_rating_key}",
        "POST",
        "Plex collection hub promotion",
    )
    visibility_query = urllib.parse.urlencode(
        {
            "promotedToRecommended": "1",
            "promotedToOwnHome": "1",
            "promotedToSharedHome": "1",
        }
    )
    plex_mutation(
        f"/hubs/sections/{encoded_library}/manage/{identifier}?{visibility_query}",
        "PUT",
        "Plex collection hub visibility update",
    )


def move_plex_collection_hub_first(library_id: str, rating_key: str) -> None:
    encoded_library = urllib.parse.quote(library_id, safe="")
    encoded_rating_key = urllib.parse.quote(rating_key, safe="")
    identifier = f"custom.collection.{encoded_library}.{encoded_rating_key}"
    plex_mutation(
        f"/hubs/sections/{encoded_library}/manage/{identifier}/move",
        "PUT",
        "Plex collection hub reorder",
    )


def update_plex_collection_title(
    library_id: str, rating_key: str, title: str, *, refresh_hub: bool = False
) -> None:
    """Normalize a Plex collection title, including Plex's legacy 409 fallback."""
    if plex_collection_title(rating_key) == title:
        if refresh_hub:
            refresh_plex_collection_hub(library_id, rating_key)
        return

    query = urllib.parse.urlencode(
        {
            "type": "18",
            "id": rating_key,
            "title.value": title,
            "title.locked": "1",
            "X-Plex-Token": plex_token,
        }
    )
    req = urllib.request.Request(f"{plex_url}/library/sections/{library_id}/all?{query}", method="PUT")
    used_fallback = False
    try:
        with urllib.request.urlopen(req, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        if error.code == 409:
            fallback_query = urllib.parse.urlencode(
                {
                    "title.value": title,
                    "title.locked": "1",
                    "X-Plex-Token": plex_token,
                }
            )
            fallback_request = urllib.request.Request(
                f"{plex_url}/library/metadata/{rating_key}?{fallback_query}", method="PUT"
            )
            try:
                with urllib.request.urlopen(fallback_request, timeout=30):
                    pass
                used_fallback = True
            except urllib.error.HTTPError as fallback_error:
                detail = fallback_error.read().decode("utf-8", errors="replace")[:500]
                raise RuntimeError(
                    f"Plex collection title fallback failed with HTTP {fallback_error.code}: {detail}"
                ) from fallback_error
            except urllib.error.URLError as fallback_error:
                raise RuntimeError("Plex collection title fallback could not reach the server") from fallback_error
        else:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Plex collection title update failed with HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("Plex collection title update could not reach the server") from error

    if plex_collection_title(rating_key) != title:
        raise RuntimeError("Plex collection title update did not persist")
    if used_fallback or refresh_hub:
        refresh_plex_collection_hub(library_id, rating_key)


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
        payload.update(
            {
                "enableSeasonFolders": season_folders_enabled,
                "seriesType": "standard",
                "monitorType": "none",
            }
        )

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

NEW_RELEASES_NAMES = {
    "movie": "New Movies",
    "show": "New Episodes",
}
NEW_RELEASES_HUB_IDENTIFIERS = {
    "movie": "movie.recentlyreleased",
    "show": "tv.recentlyaired",
}
LEGACY_RELEASE_COLLECTION_NAMES = {
    "movie": "Recently Released Movies",
    "show": "Recently Released Episodes",
}
MIGRATED_RELEASE_COLLECTION_NAMES = {
    "New Releases",
    *NEW_RELEASES_NAMES.values(),
    *LEGACY_RELEASE_COLLECTION_NAMES.values(),
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
        hub_identifier = str(hub.get("hubIdentifier") or "")
        subtype = FILTERED_HUB_SUBTYPES.get(hub_identifier)
        visibility = dict(hub.get("visibilityConfig") or {})
        is_visible = any(
            visibility.get(key) is True for key in ("usersHome", "serverOwnerHome", "libraryRecommended")
        )
        # New Movies and New Episodes are created separately with release-date
        # semantics. This pass keeps Recently Added intact and handles other hubs.
        if hub_identifier in NEW_RELEASES_HUB_IDENTIFIERS.values():
            continue
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


def new_releases_create_payload(library: dict[str, Any]) -> dict[str, Any]:
    name = NEW_RELEASES_NAMES[str(library.get("type"))]
    return {
        "id": "",
        "name": name,
        "type": "filtered_hub",
        "subtype": "recently_released",
        "template": name,
        "visibilityConfig": {"usersHome": True, "serverOwnerHome": True, "libraryRecommended": True},
        "maxItems": 30,
        "libraryIds": [library_key(library)],
        "randomizeHomeOrder": False,
        "autoPoster": False,
        "timeRestriction": {"alwaysActive": True},
    }


def configure_new_releases(libraries: list[dict[str, Any]]) -> list[str]:
    """Promote media-specific release rows without changing Recently Added."""
    response = request("/collections")
    collection_configs = response.get("collectionConfigs", []) if isinstance(response, dict) else []
    default_hubs = request("/defaulthubs")
    release_ids: list[str] = []

    existing_library_ids = {
        str(item.get("libraryId") or "")
        for item in collection_configs
        if item.get("type") == "filtered_hub"
        and (
            str(item.get("name") or "") in MIGRATED_RELEASE_COLLECTION_NAMES
        )
    }
    missing_libraries = [library for library in libraries if library_key(library) not in existing_library_ids]
    for missing_library in missing_libraries:
        request("/collections/create", method="POST", body=new_releases_create_payload(missing_library))
    if missing_libraries:
        refreshed = request("/collections")
        collection_configs = refreshed.get("collectionConfigs", []) if isinstance(refreshed, dict) else []

    for library in libraries:
        library_id = library_key(library)
        library_type = str(library.get("type"))
        name = NEW_RELEASES_NAMES[library_type]
        hub_identifier = NEW_RELEASES_HUB_IDENTIFIERS[library_type]
        native_hub = next(
            (
                hub
                for hub in default_hubs if isinstance(default_hubs, list)
                if str(hub.get("libraryId") or "") == library_id
                and str(hub.get("hubIdentifier") or "") == hub_identifier
            ),
            None,
        )
        existing = next(
            (
                item
                for item in collection_configs
                if item.get("type") == "filtered_hub"
                and str(item.get("libraryId") or "") == library_id
                and (
                    str(item.get("name") or "") == name
                    or str(item.get("name") or "") == "New Releases"
                    or str(item.get("name") or "") == LEGACY_RELEASE_COLLECTION_NAMES[library_type]
                )
            ),
            None,
        )

        if existing is None or existing.get("id") is None:
            raise RuntimeError(f"Agregarr could not create {name} for {library['name']}")

        title_changed = str(existing.get("name") or "") != name
        updated = {
            **existing,
            "name": name,
            "type": "filtered_hub",
            "subtype": "recently_released",
            "template": name,
            "visibilityConfig": {"usersHome": True, "serverOwnerHome": True, "libraryRecommended": True},
            "maxItems": 30,
            "isLibraryPromoted": True,
            "randomizeHomeOrder": False,
            "autoPoster": False,
            "timeRestriction": {"alwaysActive": True},
        }
        request(f"/collections/{existing['id']}/settings", method="PUT", body=updated)
        collection_rating_key = str(updated.get("collectionRatingKey") or "")
        if collection_rating_key:
            update_plex_collection_title(
                library_id,
                collection_rating_key,
                name,
                refresh_hub=title_changed,
            )
        existing.clear()
        existing.update(updated)
        release_ids.append(str(existing["id"]))

        if native_hub and native_hub.get("id") is not None:
            visibility = dict(native_hub.get("visibilityConfig") or {})
            request(
                f"/defaulthubs/{native_hub['id']}/settings",
                method="PUT",
                body={
                    **native_hub,
                    "visibilityConfig": {
                        **visibility,
                        "usersHome": False,
                        "serverOwnerHome": False,
                        "libraryRecommended": False,
                    },
                },
            )

    return release_ids


def visible_plex_row(item: dict[str, Any]) -> bool:
    visibility = dict(item.get("visibilityConfig") or {})
    return any(visibility.get(key) is True for key in ("usersHome", "serverOwnerHome", "libraryRecommended"))


def existing_home_order(item: dict[str, Any]) -> int:
    try:
        value = int(item.get("sortOrderHome") or 0)
    except (TypeError, ValueError):
        return 1_000_000
    return value if value > 0 else 1_000_000


def current_plex_rows() -> list[dict[str, Any]]:
    collection_response = request("/collections")
    collections = collection_response.get("collectionConfigs", []) if isinstance(collection_response, dict) else []
    preexisting = request("/preexisting")
    default_hubs = request("/defaulthubs")
    return [
        *({**item, "configType": "collection"} for item in collections),
        *({**item, "configType": "preExisting"} for item in preexisting if isinstance(preexisting, list)),
        *({**item, "configType": "hub"} for item in default_hubs if isinstance(default_hubs, list)),
    ]


def place_new_releases_first(libraries: list[dict[str, Any]], release_ids: list[str]) -> None:
    """Keep existing rows in relative order while moving each release row first."""
    release_id_set = set(release_ids)

    for library in libraries:
        library_id = library_key(library)
        rows = current_plex_rows()
        visible_rows = [
            item
            for item in rows
            if str(item.get("libraryId") or "") == library_id and visible_plex_row(item)
        ]
        visible_rows.sort(
            key=lambda item: (
                0 if str(item.get("id") or "") in release_id_set else 1,
                existing_home_order(item),
                str(item.get("name") or "").casefold(),
            )
        )
        visible_rows = [{**item, "position": index} for index, item in enumerate(visible_rows)]
        request(
            "/reorder",
            method="POST",
            body={"libraryId": library_id, "mixedItems": visible_rows, "context": "home", "mode": "manual"},
        )
        # The reorder endpoint persists each submitted object as a full
        # document. Refresh after Home so the Library write cannot restore a
        # stale sortOrderHome value from the earlier read.
        rows = current_plex_rows()
        promoted_rows = [item for item in rows if str(item.get("libraryId") or "") == library_id and item.get("isLibraryPromoted") is True]
        promoted_rows.sort(
            key=lambda item: (
                0 if str(item.get("id") or "") in release_id_set else 1,
                int(item.get("sortOrderLibrary") or 1_000_000),
                str(item.get("name") or "").casefold(),
            )
        )
        promoted_rows = [{**item, "position": index} for index, item in enumerate(promoted_rows)]
        request(
            "/reorder",
            method="POST",
            body={"libraryId": library_id, "mixedItems": promoted_rows, "context": "library", "mode": "manual"},
        )


def synced_new_release_rating_keys(
    libraries: list[dict[str, Any]], release_ids: list[str]
) -> list[tuple[dict[str, Any], str]]:
    release_id_set = set(release_ids)
    rows = current_plex_rows()
    synced: list[tuple[dict[str, Any], str]] = []
    for library in libraries:
        library_id = library_key(library)
        name = NEW_RELEASES_NAMES[str(library.get("type"))]
        release = next(
            (
                item
                for item in rows
                if item.get("configType") == "collection"
                and str(item.get("libraryId") or "") == library_id
                and str(item.get("id") or "") in release_id_set
            ),
            None,
        )
        rating_key = str((release or {}).get("collectionRatingKey") or "")
        if not rating_key:
            raise RuntimeError(f"Agregarr did not sync the {name} Plex collection for {library['name']}")
        synced.append((library, rating_key))
    return synced


def reconcile_new_releases_plex_order(libraries: list[dict[str, Any]], release_ids: list[str]) -> None:
    """Move each synced Plex hub first even when Agregarr already stores sort order 1."""
    for library, rating_key in synced_new_release_rating_keys(libraries, release_ids):
        move_plex_collection_hub_first(library_key(library), rating_key)


def verify_new_releases_plex_sort(libraries: list[dict[str, Any]], release_ids: list[str]) -> None:
    """Fail closed if Plex materializes a release row with the wrong date field."""
    expected_sorts = {
        "movie": "originallyAvailableAt:desc",
        "show": "episode.originallyAvailableAt:desc",
    }
    for library, rating_key in synced_new_release_rating_keys(libraries, release_ids):
        library_type = str(library.get("type"))
        name = NEW_RELEASES_NAMES[library_type]
        content = plex_collection_metadata(rating_key).get("content", "")
        actual_sort = urllib.parse.parse_qs(urllib.parse.urlsplit(content).query).get("sort", [""])[0]
        expected_sort = expected_sorts[library_type]
        if actual_sort != expected_sort:
            raise RuntimeError(f"{name} must use Plex sort {expected_sort}; received {actual_sort or 'none'}")


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
new_releases_ids = configure_new_releases(libraries)
place_new_releases_first(libraries, new_releases_ids)
# One full job applies the new collection configs and the disabled default-hub
# visibility together. Starting individual syncs immediately before this job
# can make two placeholder workers download the same trailer concurrently.
request("/settings/jobs/plex-collections-sync/run", method="POST")
verify_new_releases_plex_sort(libraries, new_releases_ids)
reconcile_new_releases_plex_order(libraries, new_releases_ids)

key_output.write_text(api_key, encoding="utf-8")
key_output.chmod(0o600)
print(
    f"Agregarr initialized with {len(libraries)} Plex libraries, "
    f"{len(collection_ids)} Coming Soon collections, {len(new_releases_ids)} newest-release collections, "
    f"and {len(filtered_hub_ids)} other filtered hubs"
)
