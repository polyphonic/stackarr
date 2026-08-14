import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const feedRoutes = ['feed.xml', 'feed.json'];

test('blog feeds refresh within the bounded publication verification window', async () => {
  for (const feed of feedRoutes) {
    const route = await readFile(path.join(repoRoot, 'apps/docs/src/app/blog', feed, 'route.ts'), 'utf8');

    assert.match(route, /export const revalidate = 60;/, `${feed} must refresh within one minute`);
    assert.match(
      route,
      /'Cache-Control': 'public, max-age=0, s-maxage=60, must-revalidate'/,
      `${feed} must expose the same bounded edge-cache policy`
    );
    assert.doesNotMatch(route, /s-maxage=3600/, `${feed} must not retain new posts for one hour`);
  }
});
