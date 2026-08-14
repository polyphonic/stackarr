import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cleanupArticlePublication,
  cleanupPreparedArticleAssets,
  prepareArticlePublication
} from './lib/article-publication.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function articleBody(inlineImageKey) {
  const paragraph =
    'A self-hosted homelab needs a clear network boundary, a maintained home server, tested container backups, and documented recovery checks. Operators should record each private service target, limit remote access, verify authentication, and keep storage recovery steps close to the configuration. Routine checks make the system easier to understand when DNS, routing, or application behavior changes.';

  return `## Plan the private route

${paragraph} ${paragraph}

## Configure the home server

1. Record the private service name and port.
2. Keep the container bound to the internal network.
3. Add authentication before enabling remote access.
4. Save the network and backup configuration.

${paragraph} ${paragraph}

${inlineImageKey ? `{{image:${inlineImageKey}}}\n\n` : ''}## Verify allowed and denied paths

- Test an approved account from outside the home network.
- Test a denied account and a signed-out browser.
- Confirm the origin port is not reachable directly.

${paragraph} ${paragraph}

## Recover from a failed change

Remove the public route, disable the connector, and restore the last reviewed configuration before trying again. ${paragraph} ${paragraph}`;
}

function makeDraft({ coverImagePath, inlineImagePath }) {
  return {
    title: 'How to Keep Remote Homelab Access Behind a Private Route',
    slug: 'keep-remote-homelab-access-private',
    excerpt: 'Build and verify a narrow remote path without exposing a home server directly to the public internet.',
    categorySlug: 'infrastructure-networking',
    tags: ['remote access', 'homelab security'],
    referencedServices: [],
    coverImagePath,
    coverImageAlt: 'A private route between a remote browser and one internal home server.',
    inlineImages: inlineImagePath
      ? [
          {
            key: 'private-route',
            imagePath: inlineImagePath,
            alt: 'An authenticated request follows a narrow route to one private homelab service.',
            caption: 'The route reaches only the intended internal service.'
          }
        ]
      : [],
    contentMarkdown: articleBody(inlineImagePath ? 'private-route' : undefined),
    sources: [
      {
        title: 'Remote access architecture',
        publisher: 'Cloudflare',
        url: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
        kind: 'primary'
      },
      {
        title: 'Access policy guidance',
        publisher: 'Cloudflare',
        url: 'https://developers.cloudflare.com/cloudflare-one/policies/access/',
        kind: 'primary'
      },
      {
        title: 'Internet exposure guidance',
        publisher: 'CISA',
        url: 'https://www.cisa.gov/resources-tools/resources/exposure-reduction',
        kind: 'reference'
      }
    ],
    productConnection: { relevant: false }
  };
}

async function writePng(filePath) {
  const bytes = Buffer.alloc(1200);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  await writeFile(filePath, bytes);
}

function createSanityHarness(events = []) {
  const postMutations = [];
  const client = {
    assets: {
      async upload(_type, _bytes, options) {
        events.push(`upload:${options.filename}`);
        return {
          _id: `image-${options.filename.replace(/[^a-z0-9]/gi, '')}-1200x675-png`,
          url: `https://cdn.sanity.io/images/project/production/${options.filename}`
        };
      }
    },
    async create(document) {
      postMutations.push({ method: 'create', document });
      throw new Error('preparation must not create documents');
    },
    async fetch(query) {
      if (query.includes('slug.current == $slug')) {
        events.push('guard:collisions');
        return [];
      }
      if (query.includes('"category":')) {
        events.push('guard:support');
        return { category: 'category-infrastructure-networking', author: 'author-stackarr-editorial' };
      }
      if (query.includes('[0...200]{title}')) {
        events.push('guard:titles');
        return [];
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    async publish(id) {
      postMutations.push({ method: 'publish', id });
      throw new Error('preparation must not publish documents');
    }
  };
  const publicClient = {
    async fetch() {
      events.push('guard:categories');
      return [{ categorySlug: 'data-photos' }, { categorySlug: 'gaming-emulation' }];
    }
  };

  return { client, postMutations, publicClient };
}

async function withPreparedDraft(run, { inlineImage = false } = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'stackarr-publication-'));
  const coverImagePath = path.join(workDir, 'cover.png');
  const inlineImagePath = inlineImage ? path.join(workDir, 'private-route.png') : undefined;
  const draftPath = path.join(workDir, 'article.json');
  await writePng(coverImagePath);
  if (inlineImagePath) await writePng(inlineImagePath);
  await writeFile(draftPath, JSON.stringify(makeDraft({ coverImagePath, inlineImagePath })), 'utf8');

  try {
    await run({ draftPath, workDir });
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

test('preparation never creates or publishes a post', async () => {
  await withPreparedDraft(async ({ draftPath, workDir }) => {
    const events = [];
    const { client, postMutations, publicClient } = createSanityHarness(events);

    const result = await prepareArticlePublication({
      client,
      draftPath,
      now: () => new Date('2026-08-14T08:00:00.000Z'),
      publicClient,
      repoRoot,
      resource: { projectId: 'stackarrtest', dataset: 'production' },
      verifySources: async (draft) => {
        events.push('guard:sources');
        return draft.sources.map((source) => ({ finalUrl: source.url, headlines: [], source }));
      },
      workDir
    });

    assert.equal(result.createDocuments.documents.length, 1);
    assert.deepEqual(postMutations, []);
  });
});

test('preparation returns an MCP document payload and the exact uploaded-asset manifest after all guardrails', async () => {
  await withPreparedDraft(
    async ({ draftPath, workDir }) => {
      const events = [];
      const { client, publicClient } = createSanityHarness(events);

      const rawResult = await prepareArticlePublication({
        client,
        draftPath,
        now: () => new Date('2026-08-14T08:00:00.000Z'),
        publicClient,
        repoRoot,
        resource: { projectId: 'stackarrtest', dataset: 'production' },
        verifySources: async (draft) => {
          events.push('guard:sources');
          return draft.sources.map((source) => ({ finalUrl: `${source.url}?verified=1`, headlines: [], source }));
        },
        workDir
      });
      const result = JSON.parse(JSON.stringify(rawResult));

      assert.deepEqual(events, [
        'guard:collisions',
        'guard:support',
        'guard:titles',
        'guard:categories',
        'guard:sources',
        'upload:keep-remote-homelab-access-private.png',
        'upload:keep-remote-homelab-access-private-private-route.png'
      ]);
      assert.deepEqual(Object.keys(result.createDocuments).sort(), ['documents', 'resource']);
      assert.deepEqual(result.createDocuments.resource, { projectId: 'stackarrtest', dataset: 'production' });
      assert.equal(result.createDocuments.documents.length, 1);
      assert.deepEqual(Object.keys(result.createDocuments.documents[0]).sort(), ['content', 'type']);
      assert.equal(result.createDocuments.documents[0].type, 'post');

      const content = result.createDocuments.documents[0].content;
      assert.equal(content._id, 'post-keep-remote-homelab-access-private');
      assert.equal('_type' in content, false);
      assert.deepEqual(
        Object.keys(content).sort(),
        [
          '_id',
          'author',
          'body',
          'category',
          'contentKind',
          'coverImage',
          'excerpt',
          'featured',
          'productConnection',
          'publishedAt',
          'referencedServices',
          'seo',
          'slug',
          'sources',
          'tags',
          'title'
        ].sort()
      );
      assert.equal(content.publishedAt, '2026-08-14T08:00:00.000Z');
      assert.deepEqual(content.category, {
        _type: 'reference',
        _ref: 'category-infrastructure-networking'
      });
      assert.deepEqual(content.author, { _type: 'reference', _ref: 'author-stackarr-editorial' });
      assert.equal(
        content.sources.every((source) => source.url.endsWith('?verified=1')),
        true
      );
      assert.equal(content.body.filter((block) => block._type === 'image').length, 1);
      assert.equal(
        content.body.find((block) => block._type === 'image').asset._ref,
        'image-keepremotehomelabaccessprivateprivateroutepng-1200x675-png'
      );
      assert.deepEqual(result.publishDocuments, {
        resource: { projectId: 'stackarrtest', dataset: 'production' },
        ids: ['post-keep-remote-homelab-access-private']
      });
      assert.deepEqual(result.cleanup, {
        version: 1,
        publicId: 'post-keep-remote-homelab-access-private',
        draftId: 'drafts.post-keep-remote-homelab-access-private',
        uploadedAssets: [
          {
            key: 'cover',
            assetId: 'image-keepremotehomelabaccessprivatepng-1200x675-png',
            url: 'https://cdn.sanity.io/images/project/production/keep-remote-homelab-access-private.png',
            alt: 'A private route between a remote browser and one internal home server.'
          },
          {
            key: 'private-route',
            assetId: 'image-keepremotehomelabaccessprivateprivateroutepng-1200x675-png',
            url: 'https://cdn.sanity.io/images/project/production/keep-remote-homelab-access-private-private-route.png',
            alt: 'An authenticated request follows a narrow route to one private homelab service.',
            caption: 'The route reaches only the intended internal service.'
          }
        ]
      });
    },
    { inlineImage: true }
  );
});

test('cleanup deletes only the exact draft, public ID, and uploaded assets recorded by preparation', async () => {
  const deleted = [];
  const preparation = {
    createDocuments: {
      resource: { projectId: 'stackarrtest', dataset: 'production' },
      documents: [
        {
          type: 'post',
          content: {
            _id: 'post-keep-remote-homelab-access-private',
            unrelatedAsset: { _ref: 'image-do-not-delete-1200x675-png' }
          }
        }
      ]
    },
    publishDocuments: {
      resource: { projectId: 'stackarrtest', dataset: 'production' },
      ids: ['post-keep-remote-homelab-access-private']
    },
    cleanup: {
      version: 1,
      publicId: 'post-keep-remote-homelab-access-private',
      draftId: 'drafts.post-keep-remote-homelab-access-private',
      uploadedAssets: [
        { key: 'cover', assetId: 'image-coverasset-1200x675-png' },
        { key: 'private-route', assetId: 'image-inlineasset-1200x675-png' }
      ]
    }
  };

  const result = await cleanupArticlePublication({
    client: {
      async delete(id, options) {
        deleted.push({ id, options });
      }
    },
    preparation
  });

  assert.deepEqual(deleted, [
    { id: 'drafts.post-keep-remote-homelab-access-private', options: { visibility: 'sync' } },
    { id: 'post-keep-remote-homelab-access-private', options: { visibility: 'sync' } },
    { id: 'image-inlineasset-1200x675-png', options: { visibility: 'sync' } },
    { id: 'image-coverasset-1200x675-png', options: { visibility: 'sync' } }
  ]);
  assert.deepEqual(result, {
    cleaned: true,
    documentIds: ['drafts.post-keep-remote-homelab-access-private', 'post-keep-remote-homelab-access-private'],
    assetIds: ['image-inlineasset-1200x675-png', 'image-coverasset-1200x675-png']
  });
});

test('preparation-file recovery deletes only recorded assets and never document IDs', async () => {
  const deleted = [];
  const preparation = {
    createDocuments: {
      resource: { projectId: 'stackarrtest', dataset: 'production' },
      documents: [{ type: 'post', content: { _id: 'post-keep-remote-homelab-access-private' } }]
    },
    publishDocuments: {
      resource: { projectId: 'stackarrtest', dataset: 'production' },
      ids: ['post-keep-remote-homelab-access-private']
    },
    cleanup: {
      version: 1,
      publicId: 'post-keep-remote-homelab-access-private',
      draftId: 'drafts.post-keep-remote-homelab-access-private',
      uploadedAssets: [
        { key: 'cover', assetId: 'image-coverasset-1200x675-png' },
        { key: 'private-route', assetId: 'image-inlineasset-1200x675-png' }
      ]
    }
  };

  const result = await cleanupPreparedArticleAssets({
    client: {
      async delete(id, options) {
        deleted.push({ id, options });
      }
    },
    preparation
  });

  assert.deepEqual(deleted, [
    { id: 'image-inlineasset-1200x675-png', options: { visibility: 'sync' } },
    { id: 'image-coverasset-1200x675-png', options: { visibility: 'sync' } }
  ]);
  assert.deepEqual(result, {
    cleaned: true,
    assetIds: ['image-inlineasset-1200x675-png', 'image-coverasset-1200x675-png']
  });
});

test('preparation surfaces asset rollback failures with the original error', async () => {
  await withPreparedDraft(
    async ({ draftPath, workDir }) => {
      const events = [];
      const { client, publicClient } = createSanityHarness(events);
      let uploadCount = 0;
      client.assets.upload = async () => {
        uploadCount += 1;
        if (uploadCount === 1) {
          return {
            _id: 'image-coverasset-1200x675-png',
            url: 'https://cdn.sanity.io/images/project/production/cover.png'
          };
        }
        return {};
      };
      client.delete = async () => {
        throw new Error('simulated cleanup failure');
      };

      await assert.rejects(
        prepareArticlePublication({
          client,
          draftPath,
          publicClient,
          repoRoot,
          resource: { projectId: 'stackarrtest', dataset: 'production' },
          verifySources: async (draft) =>
            draft.sources.map((source) => ({ finalUrl: source.url, headlines: [], source })),
          workDir
        }),
        (error) => {
          assert.equal(error instanceof AggregateError, true);
          assert.match(error.message, /uploaded assets could not be fully removed/i);
          assert.equal(error.errors.length, 2);
          assert.match(error.errors[0].message, /did not return an asset ID and URL/i);
          assert.equal(error.errors[1] instanceof AggregateError, true);
          return true;
        }
      );
    },
    { inlineImage: true }
  );
});
