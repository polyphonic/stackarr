# Stackarr Distribution

Distribution packages live here. Application code stays in `apps/`, reusable code
stays in `packages/`, and runtime orchestration stays in `stackarr/`.

- `macos/` builds `.app` archives with a bundled `stackarr` executable helper.
- `linux/` builds tar archives with a Sonarr-style `install.sh` and systemd unit.
- `windows/` builds Windows payload zips and carries an Inno Setup definition for
  `.exe` installers on Windows builders.
- Docker images are built from the root `Dockerfile` and tagged from
  `STACKARR_IMAGE`, which defaults to `polyphonic/stackarr:alpha`.

All native packages stage the same Next.js standalone runtime, `bin/stackarr`
helper, managed stack scripts, and package sources. The launchers prefer a
bundled Node runtime at `runtime/node` when one is supplied through
`STACKARR_NODE_RUNTIME_DIR`; otherwise they require Node.js 20 or newer on the
host. Release CI should provide official Node runtimes per platform so the
installers become self-contained.

Use package tasks from the repo root:

```bash
pnpm build
pnpm package:native
pnpm package:macos
pnpm package:linux
pnpm package:windows
docker build -t polyphonic/stackarr:alpha .
```

The Linux package follows the mature arr app install shape: application files in
`/opt/Stackarr`, runtime data in `/var/lib/stackarr`, a dedicated service user,
and `ExecStart=/opt/Stackarr/StackarrServer -nobrowser -data=/var/lib/stackarr`.

Windows native packaging is intentionally marked as alpha. The app payload and
Inno Setup installer can run the dashboard, but stack actions still depend on
the Docker/bash backend until a native Windows runner is implemented.

Only macOS has been exercised by the maintainer so far. Linux and Windows
artifacts are generated to invite platform testers; keep their release notes
explicitly marked as untested alpha until CI or maintainers validate service
startup, paths, Docker access, backup/restore, and updates on those platforms.
