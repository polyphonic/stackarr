import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { markdownToPortableText, validateArticleDraft } from './lib/article-draft.mjs';

const validDraft = {
  title: 'The Correct Way to Expose a Home Server to the Public Internet',
  slug: 'correct-way-expose-home-server-public-internet',
  excerpt:
    'Use a private tunnel, identity checks, and a narrow allowlist instead of forwarding sensitive homelab ports.',
  categorySlug: 'infrastructure-networking',
  tags: ['remote access', 'Cloudflare Tunnel', 'homelab security'],
  referencedServices: ['cloudflare', 'plex'],
  coverImageAlt: 'A private tunnel connecting an authenticated user to a home server.',
  contentMarkdown: `## Start with the threat model

A public hostname should not create a direct path to an admin dashboard. Use a private tunnel and keep the origin off the public network.

## Build the access path

1. Create a tunnel from the home server.
2. Put identity-aware access in front of the route.
3. Restrict access to an explicit email allowlist.
4. Keep the application bound to the private network.

## Verify the result

- Confirm the origin port is closed from the internet.
- Confirm an unapproved account cannot pass the access policy.
- Confirm the service still works from an approved account.

> Remote access is not complete until both the public route and the blocked paths are tested.

## Keep the configuration recoverable

Export the tunnel and access policy settings with the rest of the homelab configuration.`,
  sources: [
    {
      title: 'Cloudflare Tunnel documentation',
      publisher: 'Cloudflare',
      url: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
      kind: 'primary'
    },
    {
      title: 'Access policies documentation',
      publisher: 'Cloudflare',
      url: 'https://developers.cloudflare.com/cloudflare-one/policies/access/',
      kind: 'primary'
    },
    {
      title: 'CISA guidance on internet-exposed management interfaces',
      publisher: 'CISA',
      url: 'https://www.cisa.gov/news-events/directives/bod-23-02-mitigating-risk-internet-exposed-management-interfaces',
      kind: 'primary'
    }
  ],
  productConnection: {
    relevant: true,
    featureName: 'Cloudflare remote access setup',
    explanation: 'Stackarr can create the hostname, add Cloudflare Access, and apply an explicit email allowlist.',
    evidencePaths: ['stackarr/scripts/configure.sh'],
    docsPath: '/docs/setup/network-access'
  }
};

test('accepts a sourced homelab explainer with bounded product relevance', () => {
  const result = validateArticleDraft(validDraft, {
    repoRoot: new URL('../../..', import.meta.url).pathname
  });

  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('rejects first-person experiential framing', () => {
  const result = validateArticleDraft({
    ...validDraft,
    title: 'How I Set Up My Home Server for Plex'
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /first-person/i);
});

test('rejects off-niche topics', () => {
  const result = validateArticleDraft({
    ...validDraft,
    title: 'The Best Celebrity Fashion Trends This Summer',
    excerpt: 'A guide to celebrity fashion trends and shopping.',
    tags: ['fashion'],
    referencedServices: [],
    contentMarkdown: validDraft.contentMarkdown.replaceAll('homelab', 'wardrobe')
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /homelab niche/i);
});

test('rejects weak evidence and discovery-only sourcing', () => {
  const result = validateArticleDraft({
    ...validDraft,
    sources: [
      {
        title: 'A Reddit thread',
        publisher: 'Reddit',
        url: 'https://www.reddit.com/r/homelab/',
        kind: 'discovery'
      }
    ]
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /three sources/i);
  assert.match(result.errors.join('\n'), /two primary/i);
});

test('rejects copied or near-copied discovery headlines', () => {
  const result = validateArticleDraft({
    ...validDraft,
    title: 'The Correct Way to Expose Your Server to the Public Internet',
    discoveryHeadlines: ['The Correct Way to Expose Your Server to the Public Internet']
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /headline/i);
});

test('rejects repository evidence paths that escape into a sibling directory', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'stackarr-blog-repo-'));
  const outsideDir = `${repoRoot}-outside`;
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, 'evidence.txt'), 'not repository evidence', 'utf8');

  try {
    const result = validateArticleDraft(
      {
        ...validDraft,
        productConnection: {
          ...validDraft.productConnection,
          evidencePaths: [`../${path.basename(outsideDir)}/evidence.txt`]
        }
      },
      { repoRoot }
    );

    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /evidence does not exist/i);
  } finally {
    await Promise.all([
      rm(repoRoot, { recursive: true, force: true }),
      rm(outsideDir, { recursive: true, force: true })
    ]);
  }
});

test('rejects service slugs that are not in the local integration catalog', () => {
  const result = validateArticleDraft(
    { ...validDraft, referencedServices: ['plex', 'unreviewed-remote-service'] },
    { repoRoot: new URL('../../..', import.meta.url).pathname }
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /integration catalog/i);
});

test('rejects a canonical URL that gives article authority to another site', () => {
  const result = validateArticleDraft({
    ...validDraft,
    seo: { canonicalUrl: 'https://example.com/copied-article' }
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /canonical URL/i);
});

test('converts useful markdown structures into Portable Text', () => {
  const blocks = markdownToPortableText(validDraft.contentMarkdown);
  assert.ok(blocks.some((block) => block._type === 'block' && block.style === 'h2'));
  assert.ok(blocks.some((block) => block._type === 'block' && block.listItem === 'number'));
  assert.ok(blocks.some((block) => block._type === 'block' && block.listItem === 'bullet'));
  assert.ok(blocks.some((block) => block._type === 'callout'));
});

test('publisher refuses to read a draft outside its temporary work directory', async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'stackarr-blog-work-'));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'stackarr-blog-outside-'));
  const draftPath = path.join(outsideDir, 'article.json');
  await writeFile(draftPath, '{}', 'utf8');

  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./publish-article.mjs', import.meta.url)), draftPath],
      {
        encoding: 'utf8',
        env: { ...process.env, STACKARR_BLOG_WORK_DIR: workDir }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /draft must be a regular file inside STACKARR_BLOG_WORK_DIR/i);
  } finally {
    await Promise.all([
      rm(workDir, { recursive: true, force: true }),
      rm(outsideDir, { recursive: true, force: true })
    ]);
  }
});
