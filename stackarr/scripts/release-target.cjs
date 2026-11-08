#!/usr/bin/env node
// Resolve an explicit recovery to an existing current-version release.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
function resolveTarget(env) {
  const tag = env.PUBLISH_TAG || '';
  const expected = env.PUBLISH_REVISION || '';
  const head = git('rev-parse', 'HEAD');
  check(head === env.GITHUB_SHA, 'Checkout must match the workflow revision');
  check(env.GITHUB_REF === 'refs/heads/production', 'Release publication runs only from production');
  if (!tag && !expected) return { revision: head, tag_name: '', recover: false };
  check(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Recovery requires explicit workflow dispatch');
  check(/^v\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/.test(tag), 'Invalid release tag');
  check(/^[a-f0-9]{40}$/.test(expected), 'Recovery requires the full released commit SHA');
  const version = tag.slice(1);
  const manifest = JSON.parse(fs.readFileSync('.release-please-manifest.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  check(manifest['.'] === version && pkg.version === version, 'Recovery may publish only the current product version');
  const release = JSON.parse(
    execFileSync(
      'gh',
      ['release', 'view', tag, '--repo', env.GITHUB_REPOSITORY, '--json', 'tagName,isDraft,isPrerelease,publishedAt'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );
  check(
    release.tagName === tag && release.isDraft === false && Boolean(release.publishedAt),
    'An existing published GitHub Release is required'
  );
  check(release.isPrerelease === version.includes('-'), 'Release channel does not match the version');
  const revision = git('rev-parse', `refs/tags/${tag}^{commit}`);
  check(revision === expected, 'Tag does not match the explicitly selected released commit');
  git('merge-base', '--is-ancestor', revision, head);
  const taggedManifest = JSON.parse(git('show', `${revision}:.release-please-manifest.json`));
  const taggedPackage = JSON.parse(git('show', `${revision}:package.json`));
  check(
    taggedManifest['.'] === version && taggedPackage.version === version,
    'Tagged source version does not match the release'
  );
  return { revision, tag_name: tag, recover: true };
}
try {
  const target = resolveTarget(process.env);
  check(Boolean(process.env.GITHUB_OUTPUT), 'GITHUB_OUTPUT is required');
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(target)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('')
  );
} catch (error) {
  // Do not emit child-process output, which can contain credential diagnostics.
  console.error(error.status === undefined ? error.message : 'Release target verification failed');
  process.exitCode = 1;
}
