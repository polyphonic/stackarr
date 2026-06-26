# Manual Verification Checklist

Per request, this implementation pass did not run tests, builds, dev servers, Docker, or Stackarr commands.

When you are ready to verify:

1. Install dependencies in the repo root.
2. Start the frontend with `pnpm dev`.
3. Open the app and confirm the dashboard, setup wizard, settings, system, activity, and site routes render.
4. Call read-only endpoints first: `/api/v1/system/status`, `/api/v1/health`, `/api/v1/diskspace`.
5. Check `/api/v1/system/metrics` and confirm it only reports read-only host/compose information.
6. Confirm Stackarr has an API key in saved configuration or set one through `PUT /api/v1/config/host`.
7. Test settings saves and confirm app preferences land in SQLite at `stackarr/config/stackarr.db`.
8. Test non-disruptive commands first, such as `PermissionsAudit`, `DbInfo`, or `PlexCheck`.
9. Only then test disruptive commands such as `StackStart`, `StackConfigure`, and `Update`.
10. Confirm Plex/Jellyfin Docker profiles are only activated when their install mode is set to `docker`.
