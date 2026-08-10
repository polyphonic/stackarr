import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serviceIntegrationGroups, serviceIntegrations } from '../../../apps/docs/src/lib/service-integrations.ts';

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

  const navigationDocuments = metadata.pages.filter((page) => !page.startsWith('---'));

  assert.equal(
    navigationDocuments.length,
    new Set(navigationDocuments).size,
    'integration navigation must not contain duplicates'
  );
  assert.deepEqual([...navigationDocuments].sort(), documents);
  assert.equal(metadata.pages[0], 'index');
  assert.deepEqual(
    metadata.pages,
    [
      'index',
      ...serviceIntegrationGroups.flatMap((group) => [
        `---${group.name}---`,
        ...group.services.map((service) => service.slug)
      ])
    ],
    'integration navigation and the integration grid must share grouped alphabetical order'
  );
  assert.equal(serviceIntegrations.length, navigationDocuments.length - 1);

  for (const group of serviceIntegrationGroups) {
    assert.deepEqual(
      group.services.map((service) => service.name),
      group.services
        .map((service) => service.name)
        .sort((left, right) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })),
      `${group.name} integrations must be alphabetical by display name`
    );
  }
});
