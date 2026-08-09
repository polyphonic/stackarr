# Agregarr New Releases research

Research date: 2026-08-09

Scope: Agregarr `v2.4.2` and current official Plex support documentation. GitHub identifies [`v2.4.2`](https://github.com/agregarr/agregarr/releases/tag/v2.4.2), release commit [`5114e73`](https://github.com/agregarr/agregarr/commit/5114e73), as the latest release. The running Stackarr installation also reports version `2.4.2` with no update available.

## Recommendation

Create one **linked Agregarr `filtered_hub` group** named `New Releases`, with a movie config and a TV config, both using subtype `recently_released`. For Movies, that means movie release date; for TV, it means show-level ordering by the most recent episode's air date. Do not use the separate `recently_released_episodes` subtype for this row: in Agregarr 2.4.2 that subtype orders TV shows by episode **added-to-Plex** time (`episode.addedAt:desc`), not episode air date. Promote both rows to Home, Shared Users' Home, and each library's Recommended screen. Keep randomization off and put the group first in each library's Home/Recommended and promoted-library ordering.

This is preferable to directly enabling Plex's built-in hubs for this Stackarr configuration:

- Agregarr can discover and manage Plex's built-in `movie.recentlyreleased` (`Recently Released Movies`) and `tv.recentlyaired` (`Recently Released Episodes`) hubs. Upstream explicitly notes that Plex has no built-in `tv.recentlyreleased` show hub. The available native hubs therefore have different identifiers and content shapes, so they do not form a same-name movie/TV linked group. Agregarr also deliberately preserves a default hub's Plex-provided name, identifier, media type, and per-library sort positions when settings are updated, so it cannot rename those native hubs to `New Releases` through the settings endpoint. [Agregarr native-hub mapping](https://github.com/agregarr/agregarr/blob/v2.4.2/src/components/Collections/Views/CollectionSettings.tsx#L111-L121), [built-in hub identifiers](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/utils/HubIdentifierUtils.ts#L250-L273), [default-hub update behavior](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/services/DefaultHubConfigService.ts#L112-L175)
- Stackarr enables Agregarr's Coming Soon placeholders. Agregarr explicitly provides filtered-hub replacements so placeholder titles do not leak into Recently Added/Released rows. A filtered hub is therefore the safe upstream-native equivalent here, not an unrelated discovery list. [Filtered-hub source](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/sources/recentlyadded.ts#L1-L12), [filtered-hub creation](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/plex/PlexSmartCollectionManager.ts#L280-L365)
- `New Releases` is an upstream title preset for `recently_released`. That subtype gives the requested left-to-right order directly in Plex: movies use `originallyAvailableAt:desc`; TV shows use `episode.originallyAvailableAt:desc`, so the show with the most recently aired episode is first. Both queries exclude Stackarr's trailer placeholders and honor `maxItems` as the Plex query `limit`. [Agregarr title presets](https://github.com/agregarr/agregarr/blob/v2.4.2/src/components/Collections/Forms/titlePresets.tsx#L1659-L1677), [movie/TV sort construction](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/plex/PlexSmartCollectionManager.ts#L331-L365)

### Native Recently Added policy

`Recently Added` is a different feature and must remain separate and otherwise unchanged by this work. It answers “what entered Plex most recently” (`addedAt:desc`); `New Releases` answers “what was released/aired most recently.” Do not rename, repurpose, reorder, or delete the existing Recently Added row while ensuring New Releases, except for the existing placeholder-safety rule below.

When placeholders are enabled, no native default hub in Agregarr's four-item warning set should remain visible. Either replace it with the matching filtered version and hide the native row, or hide it without replacement if that row is not wanted:

| Native Plex hub | Safe Agregarr replacement |
| --- | --- |
| `movie.recentlyadded` | `filtered_hub` / `recently_added` |
| `tv.recentlyadded` | `filtered_hub` / `recently_added` |
| `movie.recentlyreleased` | `filtered_hub` / `recently_released` |
| `tv.recentlyaired` | `filtered_hub` / `recently_released_episodes` |

This does **not** mean New Releases should use `recently_released_episodes`. The table describes one-for-one replacements for Plex's existing native hubs. The new linked show-level `New Releases` group uses `recently_released` in both libraries. Preserve the existing Recently Added experience as its own filtered `recently_added` rows when it is meant to stay visible, and hide only its native duplicates. The native movie release row can be hidden in favor of New Releases. The native TV recently-aired-episodes row has different semantics: keep it as a separate filtered `recently_released_episodes` row only if it is independently desired; otherwise hide it without replacement. Agregarr's UI explicitly warns that all four visible native hubs are problematic when a library has placeholders, and directs the operator to create the matching filtered hub or disable the native hub when the replacement exists. [Agregarr placeholder warning and mapping](https://github.com/agregarr/agregarr/blob/v2.4.2/src/components/Collections/Views/CollectionSettings.tsx#L53-L63), [placeholder-hub decision logic](https://github.com/agregarr/agregarr/blob/v2.4.2/src/components/Collections/Views/CollectionSettings.tsx#L98-L176), [filtered-hub guidance](https://github.com/agregarr/agregarr/blob/v2.4.2/src/components/Collections/Forms/CollectionConfigForm.tsx#L243-L246)

Plex calls the per-library destination **Recommended**, not Discover. Server-managed local-library rows can appear on Library Recommended, the server owner's Home, and shared users' Home. Plex's global Discover area is a separate client surface and is not controlled by these settings. Home rows appear only for libraries the viewer has pinned/favorited, and rows remain grouped according to the viewer's library/sidebar order. [Plex Manage Recommendations](https://support.plex.tv/articles/manage-recommendations/), [Plex navigation and Discover](https://support.plex.tv/articles/navigating-the-mobile-apps/)

## Current Agregarr API contract

Agregarr's authenticated creation endpoint supports multiple `libraryIds`. It expands the request into one config per library, infers movie versus TV from each Plex library, assigns the configs a shared `linkId`, and marks them linked. Non-franchise collections default to the promoted library section. New configs without an existing sort position are auto-reordered to the front in both Home and library contexts. [Creation route](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/collections.ts#L1370-L1525), [creation reordering](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/collections.ts#L1545-L1584), [auto-reorder semantics](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/reorder.ts#L423-L479)

Recommended creation request:

```http
POST /api/v1/collections/create
Content-Type: application/json
X-Api-Key: <managed Agregarr API key>
```

```json
{
  "id": "",
  "name": "New Releases",
  "type": "filtered_hub",
  "subtype": "recently_released",
  "template": "New Releases",
  "visibilityConfig": {
    "usersHome": true,
    "serverOwnerHome": true,
    "libraryRecommended": true
  },
  "maxItems": 30,
  "libraryIds": ["<movie-library-id>", "<tv-library-id>"],
  "randomizeHomeOrder": false,
  "autoPoster": false,
  "timeRestriction": {
    "alwaysActive": true
  }
}
```

The request fields above match Agregarr's current creation type and route; `30` is its current UI default. Do not send `mediaType`, `libraryName`, `isActive`, `isLinked`, `linkId`, `isLibraryPromoted`, or a Plex collection rating key: Agregarr computes those per library. Also omit initial `sortOrderHome` and `sortOrderLibrary`; the creation route recognizes an undefined position as new and places it first. [Creation request type](https://github.com/agregarr/agregarr/blob/v2.4.2/src/types/collections/index.ts#L475-L516), [UI defaults](https://github.com/agregarr/agregarr/blob/v2.4.2/src/components/Collections/Views/CollectionSettings.tsx#L608-L627), [per-library expansion](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/collections.ts#L1380-L1525)

After creation, run the normal Plex Collections Sync job (`POST /api/v1/settings/jobs/plex-collections-sync/run`) so Agregarr creates the two Plex smart collections, publishes their visibility, and applies hub ordering. On later idempotent runs:

1. `GET /api/v1/collections` and match `name == "New Releases"`, `type == "filtered_hub"`, `subtype == "recently_released"`, and the enabled movie/TV library IDs.
2. Create only missing library configs. Do not blindly repeat `/collections/create`; duplicate collection names in the same library return HTTP 400. [Duplicate protection](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/collections.ts#L1447-L1478)
3. Update the existing linked config through `PUT /api/v1/collections/{id}/settings`, preserving its full current document while enforcing the fields above. The endpoint intentionally preserves library-specific rating keys and sort positions. [Collection update behavior](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/collections.ts#L653-L689)
4. If an existing row is not first, reorder it explicitly with `POST /api/v1/reorder`, using a fresh complete `mixedItems` list for that library and `context: "home"`, then `context: "library"`. `home` and `recommended` share `sortOrderHome`; promoted library rows use `sortOrderLibrary` starting at `1`. [Reorder endpoint](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/reorder.ts#L43-L90), [sort assignment](https://github.com/agregarr/agregarr/blob/v2.4.2/server/routes/reorder.ts#L449-L479)

When migrating an existing filtered smart collection, explicitly normalize its Plex-visible title through the same `PUT /library/sections/{libraryId}/all?type=18&id=...&title.value=...&title.locked=1` operation used by Agregarr's own Plex client. Plex can return `409 Conflict` for that preferred operation on an existing smart collection, so retry the legacy `PUT /library/metadata/{ratingKey}` form and verify the title with a metadata read. The legacy form can leave the promoted-hub manifest's old label cached; recreate that one hub with Agregarr's own delete/promote operations and restore its visibility. Plex appends a recreated hub even when Agregarr already stores sort order `1`, so complete the normal Agregarr reorder and then explicitly move the synced hub first with Agregarr's own Plex operation. The filtered-hub sync updates an existing smart collection's URI before its shared metadata pass, but this idempotent title and hub normalization avoids retaining the legacy title during migration. [Agregarr Plex title update and legacy fallback](https://github.com/agregarr/agregarr/blob/v2.4.2/server/api/plexapi.ts#L1247-L1283), [Agregarr hub refresh operations](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/plex/PlexHubManager.ts#L615-L699), [Agregarr move-first operation](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/plex/PlexHubManager.ts#L79-L109), [filtered-hub metadata flow](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/sources/recentlyadded.ts#L208-L280)

## Risks and acceptance checks

- Agregarr's `/api/v1` routes are its web application's native API, not a separately versioned external contract. Because Stackarr tracks `agregarr:latest`, keep source-contract tests for request fields, linked movie/TV expansion, sort direction, visibility, and reorder behavior.
- A manual `/reorder` call writes mixed collection, default-hub, and pre-existing-collection ordering. Always build it from fresh API reads, retain every object field and correct `configType`, and move only the target row; a partial/stale list can disturb unrelated rows.
- Use `recently_released`, not `recently_added`: the former means release/air date, while the latter means date imported into Plex. Use `recently_released_episodes` only if the desired TV row is based on episode **added** time rather than episode air date. [Agregarr subtype query definitions](https://github.com/agregarr/agregarr/blob/v2.4.2/server/lib/collections/plex/PlexSmartCollectionManager.ts#L316-L356)
- `maxItems: 30` is a count cap, not a calendar-age filter. The row is the newest 30 matching library items even if the library has had no recent releases.
- Validate both Plex library rows separately: exact title `New Releases`; first item has the newest release/episode-air date; dates are non-increasing left to right; no `Trailer (Placeholder)` item is present; at most `maxItems` items appear; the row is first in each library's Recommended section and first among that library's Home rows.
- Plex requires Plex Pass to publish a custom collection as a Home/Recommended row, and client caching can delay a visible reorder. Refresh or restart the client after server-side verification. [Plex Publishing Collections](https://support.plex.tv/articles/publishing-collections/), [Plex Manage Recommendations](https://support.plex.tv/articles/manage-recommendations/)
