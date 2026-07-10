# Contributing

## Development Setup

Stackarr uses Node.js 20 or newer and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm dev
```

The frontend runs at `http://127.0.0.1:7777` by default. Use `pnpm dev:docs` for the public docs app.

## Common Commands

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm check
pnpm format:check
pnpm --filter @stackarr/mcp build
```

For shell changes, run a syntax pass over the managed scripts:

```bash
for f in bin/stackarr stackarr/bin/stackarr stackarr/lib/common.sh stackarr/scripts/*.sh; do bash -n "$f"; done
```

## Documentation Conventions

- Keep [README.md](README.md) short: overview, quick start, repo map, and links.
- Put user-facing product docs under `apps/docs/content/docs`.
- Put maintainer, integration, and verification notes under `docs`.
- Keep Docker release notes with the Compose and image documentation.
- Put contribution workflow in this file.
- Keep committed plugin templates path-portable; install/export commands may write install-specific paths at runtime.

## Portability And Secrets

Tracked source, docs, examples, tests, compose files, and plugin metadata must not contain developer-specific absolute paths, hostnames, domains, usernames, secrets, local workspace paths, or machine-specific defaults.

Use runtime configuration, environment variables, setup prompts, or generic placeholders such as `/absolute/path/to/Stackarr` for install-specific values. Prefer app-local defaults such as `APP_ROOT/media`, `APP_ROOT/downloads`, `APP_ROOT/backups`, and `Etc/UTC`.

Runtime state may contain local values, but it should stay ignored and out of release artifacts.

## Verification

Run the smallest check that covers the change. Broaden to `pnpm test`, `pnpm typecheck`, or `pnpm check` when changing shared behavior, package boundaries, generated docs, API contracts, or UI flows.
