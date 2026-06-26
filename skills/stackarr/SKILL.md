# Stackarr Server Operations Skill

Use this skill when an agent needs to install, configure, verify, maintain, back up, or restore a Stackarr-managed media stack.

Stackarr is the control plane. Prefer Stackarr UI, API, CLI, or MCP tools over editing individual app files directly. Link users to app-specific documentation only for advanced behavior Stackarr does not manage yet.

## Safety Rules

- Treat Stackarr as local-first infrastructure. Do not expose the MCP server publicly.
- Never print saved passwords, API keys, Cloudflare tokens, tunnel tokens, or database passwords.
- Ask before commands that stop, restart, update, restore, delete, or rewrite running services.
- Use dry-runs before setup or migration changes when the tool supports them.
- Do not move Plex into Postgres. Plex stays native/external to Stackarr database setup.
- Keep install-specific paths, hostnames, usernames, and secrets out of source files and docs.

## Setup Flow

1. Inspect current state with `stackarr_get_system_status` and `stackarr_get_setup_profile`.
2. If the user asks for defaults, apply the profile defaults with a dry-run first.
3. If choices are needed, ask only material multiple-choice questions:
   - database mode: app defaults/SQLite, or shared Postgres
   - media server: native Plex, Docker Jellyfin, both, or neither
   - torrent client: Transmission or qBittorrent
   - access mode: local only, LAN, Cloudflare Tunnel, or Portless
   - backup mode: lite or full, and backup folder
4. Call `stackarr_setup_media_server` with `dryRun: true`.
5. Summarize the planned changes and ask for confirmation.
6. Apply with `dryRun: false` and `confirmSetup: true`.
7. Verify with `stackarr_get_system_status`, health checks, and recent tasks.

## Default-First Setup Prompt

When the user wants the fastest setup, offer this:

```text
I can use Stackarr defaults: app-default databases, native Plex when found, Transmission, local admin UIs, lite weekly backups, and no public tunnel. I will dry-run first and show the changes before applying them.
```

## Useful MCP Tools

| Tool | Use |
| --- | --- |
| `stackarr_get_setup_profile` | Get supported options, defaults, and required questions. |
| `stackarr_setup_media_server` | Dry-run or apply onboarding choices. |
| `stackarr_get_system_status` | Inspect services, paths, health, and storage. |
| `stackarr_get_recent_activity` | Review recorded agent actions and audit events. |
| `stackarr_get_tasks` | Inspect queued, running, and recent tasks with progress output. |
| `stackarr_start_stack` / `stackarr_stop_stack` | Start or stop the stack. Stop actions require explicit user approval. |
| `stackarr_run_backup` / `stackarr_get_backup_status` | Run and inspect backups. |
| `stackarr_restore_backup` | Restore a backup with dangerous-action confirmation. |
| `stackarr_update_cloudflare_routes` | Map public hostnames to Stackarr-managed services. |

If a requested adapter is not implemented, return that honestly and fall back to Stackarr CLI commands.

## Common CLI Fallbacks

```bash
bin/stackarr doctor
bin/stackarr configure --force
bin/stackarr backup run
bin/stackarr backup restore /path/to/archive.tar.gz
bin/stackarr database ensure
bin/stackarr db-info
```

## Database Guidance

Standard installs use app-default databases, usually SQLite inside each app's own config. Advanced installs can use the shared `database` Postgres container for Stackarr and supported apps.

When Postgres is enabled, the host connection string pattern is:

```text
postgresql://stackarr:<GLOBAL_ADMIN_PASSWORD>@127.0.0.1:5433/stackarr-main
```

For individual app databases, replace the user/database pair with the app name documented by Stackarr, such as `sonarr-main`, `radarr-main`, `lidarr-main`, or `prowlarr-main`.
