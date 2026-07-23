# Agent Rules

- Distributable code, docs, examples, compose files, tests, and generated plugin metadata must not contain developer-specific absolute paths, hostnames, domains, usernames, secrets, local workspace paths, or machine-specific defaults.
- Put install-specific values behind runtime configuration, environment variables, setup prompts, or clearly generic placeholders such as `/absolute/path/to/Stackarr`.
- Repo defaults should be portable and neutral. Prefer app-local defaults such as `APP_ROOT/media`, `APP_ROOT/downloads`, `APP_ROOT/backups`, and `Etc/UTC` unless a user explicitly asks for a personal override.
- Runtime state such as local SQLite settings, ignored files, launchd logs, and user-created scratch plans may contain local values, but do not copy those values into tracked source or documentation.

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
- Run the managed database reconciliation before recreating only the app container so its runtime credentials stay synchronized with the existing PostgreSQL roles.
- After containerized tests or temporary development services finish, run the matching Compose `down --remove-orphans` workflow and remove disposable test images or build artifacts created for that run so containers and images do not dangle.
- Never prune persistent volumes, installed-service images, or unrelated Docker resources as part of routine test cleanup.

## GitHub Actions Runtime Policy
- Never add or retain a GitHub Action release that depends on a deprecated runner Node.js runtime.
- Before changing a workflow, verify every referenced action against its current stable release, pin it to the full commit SHA, and keep the release version in an inline comment.
- Do not use `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` to suppress runtime deprecation warnings; upgrade or replace the action instead.
