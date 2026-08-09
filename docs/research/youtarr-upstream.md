# Youtarr upstream integration findings

Research date: 2026-08-09

Scope: official `DialmasterOrg/Youtarr` repository, release, documentation, source, release workflows, and Docker Hub metadata only. The current stable release is [`v1.78.0`](https://github.com/DialmasterOrg/Youtarr/releases/tag/v1.78.0), published 2026-08-07 from commit [`2bbd9ae3bdc3f1d4c18f2634485c0ff9625d1a0a`](https://github.com/DialmasterOrg/Youtarr/commit/2bbd9ae3bdc3f1d4c18f2634485c0ff9625d1a0a). The current `main` snapshot inspected after the release was [`3501e4f1f1f485780903a92e7522d26ad4ee481d`](https://github.com/DialmasterOrg/Youtarr/commit/3501e4f1f1f485780903a92e7522d26ad4ee481d).

## Executive integration decisions

- Use `dialmaster/youtarr:latest` as Stackarr's portable default so the normal managed-service update workflow receives current stable Youtarr releases. As of the research date, `v1.78.0` and `latest` resolve to the same multi-platform index digest, `sha256:07426ec8f7866ccf1e85355762e334b3195c67bb00009cb7317ddcf0f638a066`; installations that prefer reproducibility can override the image with the version tag. [Docker Hub `v1.78.0` metadata](https://hub.docker.com/v2/namespaces/dialmaster/repositories/youtarr/tags/v1.78.0), [Docker Hub `latest` metadata](https://hub.docker.com/v2/namespaces/dialmaster/repositories/youtarr/tags/latest)
- The production image supports `linux/amd64` and `linux/arm64`. The release workflow builds both platforms and publishes the version tag plus `latest`; the development workflow publishes `dev-rc.<short-sha>` plus `dev-latest`. Do not use the development tags for Stackarr's portable default. [Production workflow](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/.github/workflows/release.yml), [release-candidate workflow](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/.github/workflows/release-rc.yml)
- Youtarr does **not** support PostgreSQL or SQLite. It requires MariaDB 10.3+ or MySQL 8.0+ with `utf8mb4`. Stackarr's managed MariaDB 10.11 is supported and should be used even when an installation's normal managed-database choice is PostgreSQL. This is an upstream-native-backend exception, not a reason to run Youtarr's bundled obsolete/default credentials. [Database guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/DATABASE.md), [external-database guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/platforms/external-db.md)
- The container listens on `3011` and exposes an unauthenticated `GET /api/health` probe. The upstream Compose example maps host port `3087`, but Stackarr can keep its own loopback-only host-port convention and use `http://youtarr:3011` on the internal network. [Compose definition](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docker-compose.yml), [health route](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/health.js)
- An API key is deliberately restricted to `POST /api/videos/download`. It cannot list videos, channels, or jobs. Rich read/management tools require a seven-day session token obtained from `POST /auth/login`, so any Stackarr client that offers those tools must securely store credentials and transparently renew the session. [Authentication guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/AUTHENTICATION.md), [authentication middleware](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/server.js)
- The safest useful native MCP slice is health plus a bounded single-video queue action. A richer second tier can add bounded list/search/activity reads and explicit job termination using session authentication. Do not expose generic config replacement, arbitrary yt-dlp arguments, or broad delete endpoints.

## Image and tag policy

Youtarr uses conventional commits on `main` to calculate semantic versions. A production release publishes:

- `dialmaster/youtarr:v<major>.<minor>.<patch>`
- `dialmaster/youtarr:latest`

The `dev` branch separately publishes:

- `dialmaster/youtarr:dev-rc.<short-sha>`
- `dialmaster/youtarr:dev-latest`

Both workflows build `linux/amd64` and `linux/arm64`. The Docker Hub response also contains `unknown/unknown` manifest entries; those are small supply-chain metadata/attestation objects, not supported runtime architectures. [Production workflow](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/.github/workflows/release.yml), [release-candidate workflow](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/.github/workflows/release-rc.yml), [Docker Hub tag metadata](https://hub.docker.com/v2/namespaces/dialmaster/repositories/youtarr/tags/v1.78.0)

Recommendation: keep `dialmaster/youtarr:latest` as the tracked Stackarr default, consistent with Stackarr's managed-service update model, and retain a runtime image override for installations that deliberately pin a stable release. Do not silently substitute an old release to recover removed behavior.

## Runtime contract

### Ports and health

| Purpose | Container endpoint | Authentication | Notes |
| --- | --- | --- | --- |
| Web application and API | `3011/tcp` | Built-in auth is enabled by default | Upstream's example host mapping is `3087:3011`. |
| Container health | `GET /api/health` | None | Its route returns HTTP 200 with `{"status":"healthy"}`, and the image and Compose file both use it. In practice the global database-health middleware runs first and returns 503 during database or schema degradation, so this is not a process-only liveness probe. |
| Database readiness | `GET /api/db-status` | None | Returns 200 only when the database is connected and its schema is valid; otherwise 503. Useful as a diagnostic in addition to the Docker health check. |
| Bundled database | `3321/tcp` inside its Compose network | MariaDB credentials | Not published to the host. External databases normally use `3306`. Stackarr should use its managed MariaDB service instead of adding this bundled database. |

Sources: [Dockerfile](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/Dockerfile), [Compose definition](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docker-compose.yml), [health routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/health.js), [database-health middleware](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/server.js#L310-L360).

### Persistent paths

The standard container layout is:

| Container path | Contents | Backup importance |
| --- | --- | --- |
| `/usr/src/app/data` | Downloaded media output | Persistent and large; upstream backup tooling deliberately excludes it, so cover it through the installation's media backup policy. |
| `/app/config` | `config.json`, `complete.list`, cookies, first-run setup-token state | Critical. `complete.list` must never be lost. |
| `/app/jobs` | Job state plus `jobs/info/*.info.json` video metadata | Critical; upstream says the info JSON cannot be regenerated. |
| `/app/server/images` | Channel thumbnails/posters/cache | Persistent but optional in backups because images can regenerate. |
| `/var/lib/mysql` | MariaDB data when using the bundled database | Do not mount for the Stackarr-managed external-database design; perform a logical dump of the managed schema instead. |

The upstream Compose example uses four app bind mounts and a separate database mount. It defaults to root (`UID:GID 0:0`) for compatibility but supports non-root execution through `YOUTARR_UID` and `YOUTARR_GID`; all mounted paths must be writable by that identity. Stackarr should pass its managed UID/GID and pre-create/reconcile ownership. [Compose definition](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docker-compose.yml), [environment reference](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/ENVIRONMENT_VARIABLES.md)

`DATA_PATH` is an advanced platform override and a critical integration footgun. `isPlatformDeployment()` returns true whenever `DATA_PATH` is set to any non-empty value—even when it is set merely to the normal `/usr/src/app/data` default. In that mode, `getImagePath()` changes from `/app/server/images` to `/app/config/images`, and `getJobsPath()` changes from `/app/jobs` to `/app/config/jobs`. A Compose service that sets `DATA_PATH=/usr/src/app/data` while separately mounting `/app/server/images` and `/app/jobs` therefore leaves those two mounts unused. Standard Stackarr deployments must **omit `DATA_PATH`**, allow the built-in download default `/usr/src/app/data`, and keep the standard image/job mounts. `YOUTUBE_OUTPUT_DIR` describes/selects the host output mount in upstream Compose; it does not replace the internal volume mount by itself. [Environment reference](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/ENVIRONMENT_VARIABLES.md), [`isPlatformDeployment()` and path selection](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/modules/configModule.js#L272-L315)

### Material environment variables

| Variable | Upstream behavior | Stackarr guidance |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Application database connection. External DB default port is `3306`. | Generate/reconcile a dedicated MariaDB schema and role; pass only runtime-managed values. Treat the password as a secret. |
| `TZ` | IANA timezone for schedules and cleanup; default `UTC`. | Use the installation timezone setting. |
| `YOUTARR_UID`, `YOUTARR_GID` | Used by upstream Compose's `user:` setting; default is root. | Map Stackarr's configured service identity. These are not LinuxServer-style `PUID`/`PGID`. |
| `AUTH_ENABLED` | Built-in auth defaults to enabled. `false` bypasses all internal auth. | Leave enabled. Only permit disabling behind an explicitly configured external-auth boundary. |
| `AUTH_PRESET_USERNAME`, `AUTH_PRESET_PASSWORD` | Headless first-run credentials. If set, they overwrite UI-chosen credentials on every startup. Username is 1-32 characters; password is 8-64. | Useful for idempotent onboarding, but keep both secret-managed and explain the persistent override behavior. Do not expose the password in snapshots or diagnostics. |
| `TRUST_PROXY` | Express proxy trust. Supports `false`, hop counts such as `1`, or another Express trust-proxy value. | Use a narrow value appropriate to the generated proxy topology; do not broadly trust arbitrary forwarded headers. |
| `LOG_LEVEL` | `warn`, `info`, or `debug`; default `info`. | Keep `info` by default. Setup logs are sensitive while the one-time token is active. |
| `YOUTUBE_OUTPUT_DIR` | Host download directory/default `./downloads` in upstream scripts and Compose. | Resolve from Stackarr's managed media path and mount it at `/usr/src/app/data`; keep tracked defaults portable. |
| `DATA_PATH` | Advanced internal storage override, mainly for hosted platforms. Any non-empty value also reroutes images and jobs into `/app/config`. | Omit in the normal integration, including when downloads use the default `/usr/src/app/data`. |
| `PLEX_URL` | Overrides the Plex host/protocol/port values in `config.json`. | May pre-wire the internal URL, but it does not supply the Plex token or library ID. |
| `YOUTARR_IMAGE`, `YOUTARR_HOST_PORT` | Compose-only image and host-port overrides. | Express through Stackarr's image/port settings rather than hard-coding personal values. |

Sources: [environment reference](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/ENVIRONMENT_VARIABLES.md), [Compose definition](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docker-compose.yml), [configuration module](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/modules/configModule.js).

## Database behavior

Youtarr uses Sequelize migrations and a MariaDB/MySQL schema for channel and playlist subscriptions, video/download records, jobs, sessions, API keys, media-server users, and watch-status synchronization. It has no PostgreSQL adapter or SQLite mode. [Database guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/DATABASE.md), [database client](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/db.js)

External database requirements are:

- MariaDB 10.3+ or MySQL 8.0+.
- A database using `utf8mb4` (upstream examples use `utf8mb4_unicode_ci`).
- A dedicated user with full privileges on the Youtarr schema.
- Network connectivity from the app container.

Stackarr's managed MariaDB 10.11 satisfies those requirements. Use a dedicated schema/user, generated password, and container-internal DNS. Do not import upstream's insecure example root credentials. [External-database guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/platforms/external-db.md)

Migrations run automatically at app startup and are tracked in `SequelizeMeta`. Never upgrade MariaDB/MySQL and Youtarr at the same time: let the database upgrade and reach "ready for connections," restart it fully, then upgrade/start Youtarr so its schema migrations do not race database-internal upgrades. [Database guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/DATABASE.md), [external-database warning](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/platforms/external-db.md)

If a deployment does use the bundled database, upstream recommends a named volume instead of a bind mount on Docker Desktop, ARM, NAS, or virtualized filesystems because bind-mounted MariaDB data can corrupt during migrations. That caveat is avoided by Stackarr's managed MariaDB lifecycle and logical backups. [Compose notes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docker-compose.yml), [named-volume override](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docker-compose.arm.yml)

## Authentication and first run

Authentication is enabled by default. A fresh instance without preset credentials generates a one-time 64-hex-character setup token, logs it at `LOG_LEVEL=info`, and writes it to `/app/config/setup-token` with mode `0600`. The user enters that token plus a username/password in the setup UI; successful setup consumes the token and writes the bcrypt-hashed credentials to `/app/config/config.json`. [Authentication guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/AUTHENTICATION.md), [setup routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/setup.js), [setup-token module](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/modules/setupTokenModule.js)

For automated onboarding, `AUTH_PRESET_USERNAME` and `AUTH_PRESET_PASSWORD` skip the setup-token wizard. They continue to override stored credentials on each restart, so they must remain synchronized with Stackarr's managed secret state or be removed deliberately after first-run automation. [Authentication guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/AUTHENTICATION.md)

Session login uses `POST /auth/login`; successful tokens are sent as `x-access-token`, persist in the `Sessions` table, and expire after seven days. API keys use `x-api-key`, do not expire, are stored as SHA-256 hashes, are shown only once at creation, are limited to 20 active keys, and default to 10 requests per minute per key. [Authentication routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/auth.js), [API-key routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/apikeys.js), [API integration guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/API_INTEGRATION.md)

The critical boundary is enforced in source: an API key can access only `POST /api/videos/download`. All reads and other writes require a valid session token (unless `AUTH_ENABLED=false`, which Stackarr should not use as a convenience). [Authentication middleware](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/server.js)

## API and OpenAPI surface

A running instance serves Swagger UI at `/swagger` and the raw OpenAPI document at `/swagger.json`. However, `server/swagger.js` scans only a hard-coded subset of route files; registered modules such as subscriptions, media servers, video detail, channel search, maintenance, and subfolders are absent from that scan. Treat the released route source as authoritative for endpoints missing from OpenAPI. This is an inference from the Swagger file list and the complete route registry. [Swagger setup](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/swagger.js), [route registry](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/index.js)

### Recommended MCP actions

| Suggested action | Upstream operation | Auth | Risk and bounds |
| --- | --- | --- | --- |
| `youtarr_status` | `GET /api/health`; optionally also `GET /api/db-status` for diagnostics | None | Read-only. Return concise health/schema state rather than raw internals. |
| `youtarr_queue_video` | `POST /api/videos/download` | API key or session | Safe write with disk/network side effects. Require one YouTube video URL; optional resolution enum `360`, `480`, `720`, `1080`, `1440`, `2160`; optional validated subfolder. Reject playlists/channels and cap URL at 2048 characters as upstream does. |
| `youtarr_list_channels` | `GET /getchannels` | Session | Read-only. Bound `page` and `pageSize`; allow search/sort/subfolder filters. |
| `youtarr_list_videos` | `GET /getVideos` | Session | Read-only. Bound `page`/`limit`; expose only the documented search/date/sort/channel/protected/missing/watched filters. |
| `youtarr_search_videos` | `POST /api/videos/search` | Session | Non-mutating but invokes yt-dlp/network search. Query max is 200 characters; counts are exactly `10`, `25`, `50`, or `100`; upstream rate-limits to 10/minute and times out at 60 seconds. |
| `youtarr_list_jobs` | `GET /runningjobs` | Session | Read-only current job list. Keep output concise. |
| `youtarr_job_status` | `GET /jobstatus/:jobId` | Session | Read-only lookup by one bounded identifier. |
| `youtarr_current_activity` | `GET /api/jobs/current-activity` | Session | Read-only progress snapshot. |
| `youtarr_terminate_current_job` | `POST /api/jobs/terminate` | Session | Disruptive write. Require an explicit confirmation flag because it terminates the current download; upstream does not accept a target job ID. |

Sources: [health routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/health.js), [video routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/videos.js), [video-search route](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/videoSearch.js), [channel routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/channels.js), [job routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/jobs.js).

For a small initial Stackarr MCP surface, implement only `youtarr_status` and `youtarr_queue_video`. Add the session-authenticated tools only when Stackarr also implements secure username/password storage, token renewal after expiry, and redaction in logs/snapshots. Broad channel/playlist/config mutation routes are UI-oriented and should not be mirrored without a specific frequent use case and tighter domain schemas.

### Source-versus-documentation mismatch

The official API integration guide documents a `skipVideoFolder` property for `POST /api/videos/download`. In `v1.78.0`, the route destructures only `url`, `resolution`, and `subfolder`, and it builds download overrides only from `resolution` and `subfolder`; `skipVideoFolder` is silently ignored. Stackarr/MCP should expose only the three effective inputs until upstream source changes. [API guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/API_INTEGRATION.md), [released route implementation](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/videos.js)

Other API limitations relevant to integration:

- The API-key endpoint accepts only single `watch`, `shorts`, or `youtu.be` video URLs and rejects playlist/channel URLs. [Video route](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/videos.js)
- A successful queue response returns metadata and a message but no job ID. Tracking the corresponding job requires session-authenticated job/activity reads, so an API-key-only integration cannot reliably correlate a queued request to a later job. [Video route](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/videos.js), [job routes](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/server/routes/jobs.js)
- Upstream officially documents API keys as a single-video integration surface. The richer session routes are principally the web UI's API and may evolve more readily than that narrow external contract. [API integration guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/API_INTEGRATION.md)

## Runtime dependencies and integrations

Youtarr works without a media server. The production image includes its download/runtime toolchain: Node 20, yt-dlp, ffmpeg, AtomicParsley, Deno, Python, and Apprise. Docker plus network access to YouTube are the normal host requirements. Cookies and a YouTube Data API key are optional application configuration for content/search cases that require them. [Dockerfile](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/Dockerfile), [README](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/README.md)

Media integrations are optional:

- Plex, Jellyfin, and Emby can receive refreshed libraries/playlists and provide watched state back to Youtarr. Watch-state synchronization is one-way; Youtarr does not mark media watched on those servers. [README](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/README.md), [media-server guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/MEDIA_SERVERS.md)
- `PLEX_URL` only preconfigures/overrides the Plex URL. The Plex token and library selection still live in `config.json` and require the UI/API configuration flow. [Environment reference](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/ENVIRONMENT_VARIABLES.md), [Plex guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/media-servers/plex.md)
- Jellyfin and Emby have no supported environment variables; their URL, API key, and user ID are configured through the web UI and stored in `config.json`. [Environment reference](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/ENVIRONMENT_VARIABLES.md)

Therefore Stackarr can wire Youtarr's database, media output, internal URL, health, auth, and optional Plex URL automatically, but full Plex/Jellyfin/Emby credentials and library mapping remain a post-start/manual or future API-automation gap. Do not claim those integrations are complete merely because the containers share a network.

## Backup, restore, and upgrade cautions

Upstream's backup contract includes:

- Environment/runtime configuration (`.env` upstream; Stackarr's managed runtime snapshot is the analogous source).
- `config/config.json`.
- `config/cookies.user.txt`, when present.
- `config/complete.list`.
- A full logical MariaDB dump.
- `jobs/info/*.info.json` metadata.
- `server/images/*` thumbnails unless explicitly skipped.

Downloaded media under `YOUTUBE_OUTPUT_DIR` is intentionally excluded and must be protected through a separate media backup policy. Thumbnail files can regenerate; the job info JSON cannot. Backup archives contain database credentials, media-server/API tokens, cookies, and sessions, so store them as sensitive data and redact secrets from exported diagnostics. [Backup/restore guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/BACKUP_RESTORE.md), [backup script](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/scripts/backup.sh)

`config/complete.list` is especially critical: upstream warns never to delete it because it is the yt-dlp download archive and also records ignored videos. Losing it can cause all videos from subscribed channels to download again on the next scheduled run. [Installation guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/INSTALLATION.md)

Full restore is destructive: upstream drops/recreates and replaces the database rather than merging it. Stackarr should classify a Youtarr restore as dangerous, require explicit confirmation, and restore the managed schema plus app state as one consistent snapshot. [Backup/restore guide](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/BACKUP_RESTORE.md), [restore script](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/scripts/restore.sh)

Before an upgrade:

1. Take a logical MariaDB dump and snapshot all critical app paths.
2. If the database server itself is changing, upgrade/restart it first and wait until it is fully ready.
3. Then recreate/upgrade Youtarr and allow its startup migrations to finish.
4. Verify `/api/health`, `/api/db-status`, authentication, a bounded API action, media-path writes, and any configured media-server connection.

Never upgrade the database and app simultaneously. [External-database warning](https://github.com/DialmasterOrg/Youtarr/blob/v1.78.0/docs/platforms/external-db.md)

## Portable Stackarr acceptance checklist

- Default to `dialmaster/youtarr:latest` for managed updates; support a version-tag runtime override.
- Enable the optional service/profile and remove it cleanly when disabled.
- Use the managed MariaDB 10.11 schema/role and an internal DNS hostname; do not add PostgreSQL settings.
- Bind the host port to loopback and publish Stackarr's normal friendly internal/dashboard URL separately.
- Mount portable app-local defaults for output, config, jobs, and images; wire the installation's UID/GID and timezone. Do not set `DATA_PATH` in the standard deployment, because doing so silently reroutes images/jobs away from their standard mounts.
- Keep auth enabled, generate strong credentials, redact auth/DB/API-key values, and surface the first-run or preset-credential behavior accurately.
- Use `/api/health` for the container health check and `/api/db-status` for deeper diagnostics.
- Back up the MariaDB schema, `config`, `jobs/info`, and optionally images; cover media files separately; never delete `complete.list`.
- Treat API-key queueing and session-authenticated management as distinct capabilities.
- Keep the native MCP surface bounded and typed; require confirmation for job termination or any later bulk/delete tool.
- Mark Plex token/library and all Jellyfin/Emby setup as remaining UI/manual integration work unless an idempotent source-backed API flow is implemented and tested.
