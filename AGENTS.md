# Agent Rules

## Personal installation versus portable product work

- Requests in this repository may concern either the portable Stackarr product or the maintainer's personal installation, runtime configuration, and databases. Infer the intended scope from context; if a proposed change could reasonably belong to either scope and the distinction would affect tracked files, ask before editing.
- Keep personal setup, one-off migration or repair logic, database adjustments, host-specific paths, device names, and local automation out of tracked product code and documentation. Personal runtime files may still live under Stackarr-managed state or configuration directories so the existing backup system preserves them; backup coverage does not make those files part of the distributable product.
- Never copy identifying personal paths, hostnames, domains, usernames, credentials, library layouts, or machine-specific defaults from runtime state into the repository. Generalize a capability only when it is genuinely useful to end users and expose install-specific values through portable runtime configuration.

- Distributable code, docs, examples, compose files, tests, and generated plugin metadata must not contain developer-specific absolute paths, hostnames, domains, usernames, secrets, local workspace paths, or machine-specific defaults.
- Put install-specific values behind runtime configuration, environment variables, setup prompts, or clearly generic placeholders such as `/absolute/path/to/Stackarr`.
- Repo defaults should be portable and neutral. Prefer app-local defaults such as `APP_ROOT/media`, `APP_ROOT/downloads`, `APP_ROOT/backups`, and `Etc/UTC` unless a user explicitly asks for a personal override.
- Runtime state such as local SQLite settings, ignored files, launchd logs, and user-created scratch plans may contain local values, but do not copy those values into tracked source or documentation.

## Adding Homelab Images

Treat a Docker image or repository request as an end-to-end Stackarr integration, not only a Compose service:

- Research the current official image and documentation first. Confirm supported architectures, ports, health checks, persistent paths, environment variables, database backends, authentication, APIs, and known integration gaps; do not pin an obsolete release to regain removed functionality.
- Keep application images current with the upstream stable moving tag when upgrades do not threaten persisted data or configuration; Youtarr and tinyMediaManager should use `latest` by default. Pin stateful infrastructure such as database engines, or another component whose automatic major upgrade can break stored data/configuration, and retain runtime overrides for deliberate per-install pins.
- Keep tracked defaults portable. Put host paths, domains, usernames, credentials, IDs, and personal preferences behind managed runtime configuration, using app-local neutral defaults and generated secrets where appropriate.
- Honor the installation's selected database mode. Use and reconcile managed PostgreSQL databases and roles when the app supports PostgreSQL; use the current upstream-native backend only when PostgreSQL is unsupported, and document and test that exception.
- Add the complete runtime lifecycle: optional profile or service selection, Compose service, internal DNS URL, loopback host binding, PUID/PGID/timezone where supported, persistent storage, health check, labels, dependencies, enable/disable handling, update/apply paths, disabled-service cleanup, runtime export/snapshot, secret redaction, and backup coverage where applicable.
- Add the complete end-user experience: onboarding/setup inputs and defaults, dashboard settings and service directory, logo, browser links, connection/status diagnostics, CLI help/actions, MCP service selection, and user documentation. Every added image must produce a visible dashboard change.
- Add a small native MCP surface when the app exposes a stable API. Cover only frequent read and management actions, use bounded typed inputs and concise outputs, gate tools on the enabled service, classify write/destructive risk correctly, and avoid mirroring verbose or rarely used administrative APIs.
- Wire common dependencies through container-internal URLs and shared runtime credentials or paths. Prefer an idempotent setup command or API flow over manual UI steps, preserve existing user configuration, and do not enable imports or management that would conflict with another app's source of truth.
- Integrate local access completely: localhost URL, Portless alias and dashboard URL, plus opt-in Cloudflare routing where supported. Apply the host routing and verify the friendly URL actually resolves and reaches the app; registering an alias alone is not completion.
- After the portable implementation, configure the developer's ignored local runtime as though onboarding had just completed: honor the selected database/download client/media paths, reuse existing credentials where intended, reconcile with the generated runtime Compose project, and test real dependency connections without copying personal values into tracked files.
- Rebuild the Stackarr controller locally from the working tree through the generated runtime Compose project so dashboard and MCP changes are tested. Do not use the published Docker Hub Stackarr image to validate unshipped source changes, and never run the repository Compose file directly.
- Verify Compose rendering, formatting/linting, type checks, focused and full tests, portability/secret scans, container health, authentication, dependency connections, frequent MCP actions, dashboard visibility, and the final localhost and Portless URLs. Report unsupported upstream capabilities and any remaining host-approval step explicitly.

## Commit Message Conventions
- Use Angular/Conventional commit subjects: `type(scope): description`.
- Valid types are `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`, `temp`, and `config`.
- Use the full commit format for agent-created commits:

```text
type(scope): concise subject

One short paragraph describing what changed and why.

Note: call out important context, exclusions, remaining local changes, or verification details.
```

- Keep the subject concise and imperative. Use lowercase type/scope.
- Include `Note:` whenever committing on behalf of an agent, even if the note is just to say there are no unrelated local changes included.

## Branch and Deployment Workflow

- `production` is the protected trunk and the production deployment branch. Never commit or push directly to `production`.
- All production changes must be developed on another branch and merged into `production` through the repository's protected merge workflow.
- Name working branches with a Conventional Commit type prefix such as `feat/`, `fix/`, `docs/`, `refactor/`, or `chore/`. Do not add agent- or tool-specific prefixes.
- Follow trunk-based development: keep feature branches short-lived, integrate frequently, and treat `production` as the single source of truth.
- `preview` is the live staging branch for testing changes in a production-like environment before they are merged into `production`.
- Do not treat `preview` as an alternate trunk or allow it to drift indefinitely. Promote tested work through a deliberate merge into `production`.

## Local Container Hygiene

- Recreate local Stackarr images through the generated runtime Compose project (`stackarr_compose` or the corresponding `bin/stackarr` workflow), never by running the repository Compose file directly. This keeps the app in the same Docker Compose project as the installed stack.
- From the repository root, use `stackarr/bin/stackarr up` for a full local reconciliation. Never run `docker compose up` against `stackarr/docker-compose.yml`, even with `--project-name stackarr`: Docker records the Compose file and working directory on each container, which splits the stack into separate Docker Desktop groups. Use `stackarr/bin/stackarr update services` or `stackarr/bin/stackarr update app` when the task specifically requires the corresponding update workflow.
- Run the managed database reconciliation before recreating only the app container so its runtime credentials stay synchronized with the existing PostgreSQL roles.
- After containerized tests or temporary development services finish, run the matching Compose `down --remove-orphans` workflow and remove disposable test images or build artifacts created for that run so containers and images do not dangle.
- Never prune persistent volumes, installed-service images, or unrelated Docker resources as part of routine test cleanup.

## GitHub Actions Runtime Policy
- Never add or retain a GitHub Action release that depends on a deprecated runner Node.js runtime.
- Before changing a workflow, verify every referenced action against its current stable release, pin it to the full commit SHA, and keep the release version in an inline comment.
- Do not use `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` to suppress runtime deprecation warnings; upgrade or replace the action instead.
