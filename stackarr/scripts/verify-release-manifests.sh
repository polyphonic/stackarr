#!/usr/bin/env bash
# Verify all release tags resolve to the same per-registry multi-platform manifest.
set -euo pipefail

: "${VERSION:?VERSION is required}"
: "${REVISION:?REVISION is required}"
: "${CHANNEL:?CHANNEL is required}"
[[ "$REVISION" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full Git revision' >&2; exit 1; }
[[ "$CHANNEL" == alpha || "$CHANNEL" == beta || "$CHANNEL" == stable ]] || { echo 'Unknown release channel' >&2; exit 1; }

for registry in docker.io ghcr.io; do
  image="$registry/polyphonic/stackarr"
  version_ref="$image:$VERSION"
  digest=$(docker buildx imagetools inspect "$version_ref" --format '{{.Manifest.Digest}}')
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Invalid manifest digest for $version_ref" >&2; exit 1; }

  tags=("$VERSION" "sha-$REVISION" latest)
  if [[ "$CHANNEL" != stable ]]; then tags+=("$CHANNEL"); fi
  if [[ "$CHANNEL" == stable ]]; then
    [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid stable version' >&2; exit 1; }
    major=${VERSION%%.*}
    minor=${VERSION%.*}
    tags+=("$major" "$minor")
  fi
  for tag in "${tags[@]}"; do
    ref="$image:$tag"
    actual=$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}')
    [[ "$actual" == "$digest" ]] || { echo "Manifest mismatch: $ref does not match $version_ref" >&2; exit 1; }
    docker buildx imagetools inspect "$ref" --raw | jq -e '
      [.manifests[]?.platform
        | select(.os == "linux" and (.architecture == "amd64" or .architecture == "arm64"))
        | .architecture]
      | unique | length == 2
    ' >/dev/null || { echo "Missing Linux AMD64 or ARM64: $ref" >&2; exit 1; }
  done
  if [[ "$registry" == docker.io ]]; then
    echo "hub_digest=$digest" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
  else
    echo "ghcr_digest=$digest" >> "$GITHUB_OUTPUT"
  fi
done
