import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const iconUrl = 'https://stackarr.app/icon-512.png';
const productDescription =
  '[Stackarr](https://stackarr.app/) is a chat-first Docker control plane for self-hosted apps and homelabs.';
const imageUrl = 'https://hub.docker.com/r/polyphonic/stackarr';
const staleStackarrUrls =
  /https:\/\/github\.com\/stackarr\/stackarr|https:\/\/raw\.githubusercontent\.com\/stackarr\/stackarr|https:\/\/raw\.githubusercontent\.com\/b-bot\/Stackarr\/main|https:\/\/raw\.githubusercontent\.com\/b-bot\/Stackarr\/production\/Logo\/stackarr-512\.png/i;

test('release metadata points at the public Stackarr logo URL', async () => {
  const files = ['Dockerfile', 'stackarr/docker-compose.yml', 'README.md'];

  for (const file of files) {
    const content = await readFile(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(content, staleStackarrUrls, `${file} should not point at stale Stackarr URLs`);
  }

  const dockerfile = await readFile(path.join(repoRoot, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, new RegExp(escapeRegExp(productDescription)));
  assert.match(dockerfile, new RegExp(escapeRegExp(imageUrl)));
  assert.match(dockerfile, new RegExp(escapeRegExp(iconUrl)));
  assert.match(dockerfile, /FROM node:22-alpine3\.20@sha256:[a-f0-9]{64} AS deps/);
  assert.match(dockerfile, /FROM node:22-alpine3\.20@sha256:[a-f0-9]{64} AS runner/);
  assert.doesNotMatch(dockerfile, /streamrip\/archive\/refs\/heads\/dev\.tar\.gz/);
  assert.match(dockerfile, /\nUSER node\n/);
  assert.match(
    await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8'),
    new RegExp(escapeRegExp(iconUrl))
  );

  const stackarrCli = await readFile(path.join(repoRoot, 'stackarr/bin/stackarr'), 'utf8');
  assert.match(stackarrCli, /-f "\/\.dockerenv" \|\| -f "\/run\/\.containerenv"/);
});

test('release manifest targets the repository root and keeps shipped versions aligned', async () => {
  const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };
  const manifest = JSON.parse(await readFile(path.join(repoRoot, '.release-please-manifest.json'), 'utf8')) as Record<
    string,
    string
  >;
  const config = JSON.parse(await readFile(path.join(repoRoot, 'release-please-config.json'), 'utf8')) as {
    packages?: Record<string, { 'extra-files'?: Array<string | { path?: string }> }>;
  };
  const rootRelease = config.packages?.['.'];

  assert.ok(rootRelease, 'release-please must declare the repository root as a package');
  assert.equal(manifest['.'], rootPackage.version);

  const extraFiles = (rootRelease['extra-files'] ?? []).map((entry) =>
    typeof entry === 'string' ? entry : entry.path
  );
  const requiredVersionFiles = [
    'Dockerfile',
    'apps/docs/src/env/client.ts',
    'apps/docs/content/docs/installation/docker.mdx',
    'packages/core/src/version.ts'
  ];

  for (const file of requiredVersionFiles) {
    assert.ok(extraFiles.includes(file), `${file} must be updated by release-please`);
    assert.match(await readFile(path.join(repoRoot, file), 'utf8'), new RegExp(escapeRegExp(rootPackage.version)));
  }

  const releaseWorkflow = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseWorkflow, /release-please:\n\s+name: Prepare release\n\s+needs: docker-smoke/);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
