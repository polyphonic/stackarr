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

## GitHub Actions Runtime Policy
- Never add or retain a GitHub Action release that depends on a deprecated runner Node.js runtime.
- Before changing a workflow, verify every referenced action against its current stable release, pin it to the full commit SHA, and keep the release version in an inline comment.
- Do not use `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` to suppress runtime deprecation warnings; upgrade or replace the action instead.
