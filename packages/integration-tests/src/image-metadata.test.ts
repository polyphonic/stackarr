import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const iconUrl = 'https://raw.githubusercontent.com/b-bot/Stackarr/production/Logo/stackarr-512.png';
const staleStackarrUrls =
  /https:\/\/github\.com\/stackarr\/stackarr|https:\/\/raw\.githubusercontent\.com\/stackarr\/stackarr|https:\/\/raw\.githubusercontent\.com\/b-bot\/Stackarr\/main/i;

test('release metadata points at the public Stackarr logo URL', async () => {
  const files = [
    'Dockerfile',
    'stackarr/docker-compose.yml',
    'apps/docs/content/docs/operations/docker-hub.mdx',
    'distribution/windows/setup/stackarr.iss'
  ];

  for (const file of files) {
    const content = await readFile(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(content, staleStackarrUrls, `${file} should not point at stale Stackarr URLs`);
  }

  assert.match(await readFile(path.join(repoRoot, 'Dockerfile'), 'utf8'), new RegExp(escapeRegExp(iconUrl)));
  assert.match(
    await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8'),
    new RegExp(escapeRegExp(iconUrl))
  );
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
