# Stackarr Architecture

Stackarr is now organized as a Next.js-first arr-style control plane.

## Layout

- `apps/frontend` contains the Next.js App Router UI and `/api/v1` endpoints.
- `packages/core` contains shared config parsing, redaction, command metadata, task state, service summaries, and notification schemas.
- `packages/ui` contains shared HeroUI/Nucleo components and theme primitives.
- `packages/cli` packages the `stackarr` executable wrapper.
- `packages/integration-tests` contains the integration test workspace.
- `distribution` contains release packaging such as macOS app archives.
- `stackarr` contains the shell scripts, config presets, hooks, and Docker Compose file.
- Stackarr-backed app settings are the runtime configuration store; service URLs, images, ports, paths, credentials, and Cloudflare settings are managed through the UI/API/MCP layer. SQLite remains the default runtime store, and advanced installs can move Stackarr settings to the shared Postgres database while keeping SQLite as a bootstrap/import source rather than a second live copy.

## Executable Boundary

The frontend does not duplicate stack behavior. Commands are represented with arr-style names, queued as tasks, and run through `bin/stackarr` when requested from the API.

## API

The primary API namespace is `/api/v1`, matching the arr family naming style:

- `GET /api/v1/system/status`
- `GET /api/v1/health`
- `GET /api/v1/diskspace`
- `GET /api/v1/task`
- `POST /api/v1/command`
- `GET /api/v1/command/:id`
- `GET /api/v1/backup`
- `GET /api/v1/log/file`
- `GET/PUT /api/v1/config/host`
- `GET/PUT /api/v1/config/stackarr`
- `GET/POST /api/v1/notification`
- `GET /api/v1/notification/schema`

Mutating API calls require `X-Api-Key`. CLI setup and the first dashboard config save create an API key; command endpoints fail closed when no key is configured.

## Settings Storage

Stackarr uses a split that mirrors the arr apps' app-data pattern:

- Saved app settings store runtime values, including paths, ports, install modes, and secrets. Docker Compose environment variables remain available only for advanced container-specific overrides.
- The Stackarr runtime database stores app-level UI, host, profile, metadata, public-exposure preferences, and Connect notification definitions. `stackarr/config/stackarr.db` is the default SQLite store and becomes a bootstrap/import file when settings are moved to Postgres.
- `stackarr/config/*.json` remains the versioned source for naming, download, and request presets.

The UI redacts secrets before sending config to the browser. Browser actions send the saved API key, prompting once when needed and storing it locally for subsequent requests.

## Media Servers

Plex and Jellyfin are independent:

- `PLEX_INSTALL_MODE=disabled|native|docker`
- `JELLYFIN_INSTALL_MODE=disabled|native|docker`

Native mode records paths and exposes status/config guidance. If an existing native Plex or Jellyfin config path is found, Stackarr reports it as detected infrastructure and can build monitoring/features around it without owning the process. Docker mode adds the matching Compose profile when Stackarr starts or updates the stack.
