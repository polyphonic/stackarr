# Draft instance metadata transports

The catalog is a list of canonical app definitions, **not** installed/configured apps. Instances here are draft metadata records only. Creating, renaming, or removing a draft does not install an app, change a container, or affect an existing runtime.

The same version-1 DTO and core action are used by HTTP (`GET /api/v1/app-definitions`, `GET/POST /api/v1/instances`, `PATCH/DELETE /api/v1/instances/{id}`), MCP, and CLI. The five operations and risk/scope mapping are declared in `packages/core/src/instanceOperations.ts`.

CLI: `stackarr instances catalog`, `stackarr instances list [--limit 1..100] [--cursor UUID]`, `stackarr instances create` (JSON `{ "definitionId": "sonarr", "displayName": "TV", "ownership": "managed" }` on stdin), `stackarr instances rename UUID` (JSON `{ "displayName": "TV 2" }` on stdin), `stackarr instances remove UUID --yes`. JSON input is limited to 16 KiB; private configuration and secret-reference fields are not accepted. Host CLI runs the installed controller; it does not create a host-side fallback database.

MCP tools: `stackarr_list_app_definitions` and `stackarr_list_instance_drafts` are readable in observe; `stackarr_create_instance_draft` and `stackarr_rename_instance_draft` require manage/write; `stackarr_remove_instance_draft` is dangerous and requires admin plus the existing interactive approval flow (unless deliberately using unrestricted authority). No generic shell or Docker operation is exposed. Store failures return `store_unavailable` without database or connection details; invalid inputs and absent IDs return `invalid_input` and `not_found`.

Mutation responses include `audit: { id, status }`. `recorded` means the activity result was read back. `degraded` means the mutation succeeded but its final audit record could not be verified. Do not retry a successful mutation because its audit status is degraded. Failure to persist and verify the initial audit record prevents mutation. Audit summaries contain only the operation, validated instance UUID, and outcome.

All five MCP inputs reject unknown fields. Rename bodies accept only `displayName`, never an `id`, including one matching the path or CLI argument. HTTP DELETE rejects any request body. Only CLI `create` and `rename` read JSON from stdin. CLI `remove` uses the explicit UUID and `--yes` arguments and does not interpret stdin as configuration. CLI instance failures exit nonzero and write a JSON `error` object with `code` and `message` to stderr, without a Node stack trace.

This is source-only draft functionality. Disposable PostgreSQL upgrade/restore, real controller dispatch, app configuration, lifecycle, legacy runtime migration, and the completed Add App flow still require qualification. The SQLite upgrade tests and captured PostgreSQL SQL do not establish live PostgreSQL acceptance.
