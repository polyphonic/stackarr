import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const guardScript = path.join(repoRoot, 'stackarr/scripts/agregarr-placeholder-guard.cjs');

const vulnerableCleanup = `
const isOrphaned = !sourceTmdbIds.has(placeholder.tmdbId);
const isStale = placeholder.createdAt &&
    Date.now() - placeholder.createdAt.getTime() >
        STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
if (isStale) {
    removePlaceholder(placeholder);
}
`;

const vulnerablePlaceholderManager = `
    const sanitizedTitle = sanitizeFilename(title);
    const yearStr = year ? \` (\${year})\` : '';
    const showDir = path_1.default.join(libraryPath, \`\${sanitizedTitle}\${yearStr}\`);
`;

test('Agregarr placeholder guard preserves source items after the upstream seven-day threshold', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-agregarr-placeholder-guard-'));
  const target = path.join(root, 'PlaceholderCleanup.js');
  const placeholderManager = path.join(root, 'placeholderManager.js');

  try {
    await writeFile(target, vulnerableCleanup);
    await writeFile(placeholderManager, vulnerablePlaceholderManager);
    await execFile(process.execPath, [guardScript, target, placeholderManager]);

    const guarded = await readFile(target, 'utf8');
    const guardedManager = await readFile(placeholderManager, 'utf8');
    assert.match(guarded, /const isStale = isOrphaned &&\s+placeholder\.createdAt &&/);
    assert.match(guarded, /if \(isStale\)/);
    assert.doesNotMatch(guarded, /const isStale = placeholder\.createdAt &&/);
    assert.match(guardedManager, /year && !sanitizedTitle\.endsWith\(\` \(\$\{year\}\)\`\)/);
    assert.doesNotMatch(guardedManager, /const yearStr = year \?/);

    const firstPass = guarded;
    const firstManagerPass = guardedManager;
    await execFile(process.execPath, [guardScript, target, placeholderManager]);
    assert.equal(await readFile(target, 'utf8'), firstPass);
    assert.equal(await readFile(placeholderManager, 'utf8'), firstManagerPass);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Agregarr placeholder guard fails closed when upstream cleanup code is unrecognized', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-agregarr-placeholder-guard-'));
  const target = path.join(root, 'PlaceholderCleanup.js');
  const placeholderManager = path.join(root, 'placeholderManager.js');
  const unknownCleanup = vulnerableCleanup.replace('placeholder.createdAt &&', 'placeholder.updatedAt &&');

  try {
    await writeFile(target, unknownCleanup);
    await writeFile(placeholderManager, vulnerablePlaceholderManager);
    await assert.rejects(
      execFile(process.execPath, [guardScript, target, placeholderManager]),
      /refusing to start Agregarr/i
    );
    assert.equal(await readFile(target, 'utf8'), unknownCleanup);
    assert.equal(await readFile(placeholderManager, 'utf8'), vulnerablePlaceholderManager);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Agregarr runs the placeholder guard as root before dropping to the configured runtime user', async () => {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  const common = await readFile(path.join(repoRoot, 'stackarr/lib/common.sh'), 'utf8');
  const guard = await readFile(guardScript, 'utf8');

  assert.match(compose, /agregarr:[\s\S]*user: "0:0"/);
  assert.match(compose, /agregarr:[\s\S]*agregarr-placeholder-guard\.cjs/);
  assert.match(compose, /agregarr:[\s\S]*"\$\$\{PUID\}" "\$\$\{PGID\}" "\$\$@"/);
  assert.match(guard, /process\.setgroups\(\[\]\);[\s\S]*process\.setgid[\s\S]*process\.setuid/);
  assert.match(common, /agregarr-placeholder-guard\.cjs/);
});
