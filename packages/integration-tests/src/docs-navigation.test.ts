import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('every integration document appears in the docs navigation', async () => {
  const integrationsRoot = path.join(repoRoot, 'apps/docs/content/docs/integrations');
  const documents = (await readdir(integrationsRoot))
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => name.slice(0, -'.mdx'.length))
    .sort();
  const metadata = JSON.parse(await readFile(path.join(integrationsRoot, 'meta.json'), 'utf8')) as {
    pages: string[];
  };

  assert.equal(
    metadata.pages.length,
    new Set(metadata.pages).size,
    'integration navigation must not contain duplicates'
  );
  assert.deepEqual([...metadata.pages].sort(), documents);
});
