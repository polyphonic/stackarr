# Stackarr releases and container images

## Source of truth

A protected Git tag and its GitHub Release are the source of truth for a Stackarr release. Docker Hub and GitHub Container Registry (GHCR) publish the same release image from that tag; neither registry is the version authority.

The release workflow uses [Release Please](https://github.com/googleapis/release-please-action) and Conventional Commits. It opens a release PR containing the version bump and generated changelog. Merging that PR creates the GitHub prerelease and builds the images once for both registries. GitHub Actions are pinned to immutable commit SHAs and kept current through Dependabot.

## Version and tag policy

Stackarr is in alpha, so every tester-facing build must be a SemVer prerelease such as `0.3.0-alpha.2`. Releasable changes increment the alpha counter for the current milestone; intentionally start a new milestone with a Conventional Commit footer such as `Release-As: 0.4.0-alpha.0`.

| Purpose | Example | Mutability | Use |
| --- | --- | --- | --- |
| Exact alpha version | `0.3.0-alpha.2` | Never intentionally overwritten | Support, rollback, reproducibility |
| Alpha channel | `alpha` | Moves to the newest alpha release | Opt-in feedback and early testing |
| Commit trace | `sha-<40-character Git commit>` | Immutable in normal release flow | Forensics and exact build identification |
| Stable version | `1.2.3` | Never intentionally overwritten | Production pin |
| Rolling release stream | `latest` | Moves on each published release, including alpha/beta prereleases | Explicit opt-in to the newest published build |
| Stable convenience tags | `1.2`, `1` | Move only on a stable release | Stable version channels |

`latest` is **not** a stable channel or an assertion of production readiness. It follows the current published release stream, including prereleases, and is never promoted to a fictitious stable version. Installations default to `polyphonic/stackarr:alpha`; operators who want the full rolling stream can explicitly set `STACKARR_IMAGE=polyphonic/stackarr:latest` (or `ghcr.io/polyphonic/stackarr:latest`) in their managed runtime configuration. Use an exact version or registry-specific `@sha256:<digest>` for reproducible deployments and rollback. The app updater pulls the configured image reference; this policy does not change any installation's image selection by itself. Enable immutable tags in Docker Hub when the plan supports it, protect `v*` tags in GitHub, and never retag a released commit to different content.

Users who report an issue should include the exact version or digest, not only the moving `alpha` tag.

## Registries

Keep both registries:

- **Docker Hub** (`polyphonic/stackarr`) remains the primary pull location in installation docs because it is familiar to self-hosters and NAS package managers.
- **GHCR** (`ghcr.io/polyphonic/stackarr`) is the GitHub-native mirror for repository traceability, permissions, and artifact attestations.

The release workflow builds once from the release tag and publishes the same multi-platform image to both registries. It verifies the exact version, `sha-<commit>`, `latest`, and applicable channel tags resolve to the same manifest within **each** registry, with Linux AMD64 and Linux ARM64 present. It records each registry's manifest digest in the GitHub Release. A release is incomplete if either registry does not receive the traceable tags or the rolling tag. Digests can differ between registries; pin the digest from the registry you pull.

## Platforms

The distributed container targets Linux only, with both `linux/amd64` and `linux/arm64` manifests:

| Host | Container selected | Notes |
| --- | --- | --- |
| Linux x64 | `linux/amd64` | Native Docker Engine or compatible runtime |
| Linux ARM64 / NAS | `linux/arm64` | Includes Apple Silicon-capable images and ARM NAS support |
| macOS Docker Desktop | Linux image matching Mac CPU | No `darwin/*` container image is required |
| Windows Docker Desktop / WSL2 | Linux image matching host/VM CPU | No `windows/*` container image is required |

Native macOS and Windows launchers, installers, or CLI binaries are future GitHub Release assets. They share the same Stackarr version and release notes, but are separate artifacts from the OCI image.

## Release notes

Every release should state:

1. User-visible changes and fixes.
2. Breaking changes, migrations, backup/restore considerations, and any required Compose changes.
3. Exact image tags for Docker Hub and GHCR, plus the relevant registry digest for support and rollback.
4. Tested platforms/architectures and known limitations.
5. A clear feedback request for alpha testers, linking the platform-test issue form.

Use Conventional Commit types so Release Please can group notes predictably: `feat` for user-visible capabilities, `fix` for defects, `perf`, `security`, `docs`, `refactor`, `build`, and `ci`. Use `!` or a `BREAKING CHANGE:` footer for an incompatible migration.

## Release handoff and installed-image verification

A source change merged into `production` is not a published container image. A GitHub Release or tag is not proof that both registries finished publishing, and publication is not proof that an installation updated. Before calling a rollout complete, record each independent state:

- Source: merged commit SHA and the release tag's source SHA.
- Publication: exact version, registry multi-platform manifest digest, and target-platform image digest, verified after the image-publishing job completes.
- Installation: running container image ID, repository/manifest digest when available, image version and OCI revision; compare the platform image identity and source revision with the published artifact, then verify application health with a fresh protected API request (and Docker health when the image defines a health check).

If any stage is pending or does not match, report it as such instead of treating a merge, release record, image pull, or running container alone as rollout completion. A source-only correction can remain queued for the next approved release; it does not require an immediate publication or local installation.

## Release checklist

- [ ] The release PR has the intended SemVer alpha version and generated changelog.
- [ ] CI passes, including the Linux image smoke build.
- [ ] The GitHub prerelease is marked prerelease and contains upgrade guidance.
- [ ] `linux/amd64` and `linux/arm64` are present for the exact tag in Docker Hub and GHCR.
- [ ] The moving `alpha` tag points at the exact alpha-version manifest in both registries.
- [ ] `latest` points at the exact released manifest in both registries, even for prereleases; it is not labeled stable.
- [ ] The immutable `sha-<40-character Git commit>` tag resolves to the same multi-platform manifest in both registries.
- [ ] The release digest, version, host OS, Docker runtime, and architecture are requested in alpha feedback.
- [ ] The landing-page telemetry collector has its database migration, server-only signing key, and Upstash rate-limit credentials configured before the public telemetry feature is announced.
