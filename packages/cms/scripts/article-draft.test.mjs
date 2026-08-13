import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { markdownToPortableText, validateArticleDraft } from './lib/article-draft.mjs';
import {
  findCopiedSentences,
  isSupportedSourceContentType,
  publisherMatchesSource,
  validateSourceIdentity,
  verifyArticleSources
} from './lib/source-verification.mjs';

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

A public hostname should not create a direct path to an admin dashboard. Use a private tunnel and keep the origin off the public network. Record which users need access, which application needs a route, and which local address the connector can reach. This keeps the design narrow before any DNS record becomes public.

A tunnel removes the inbound port forward, but it does not replace authentication. The public hostname still needs an identity policy. The application should also keep its own login enabled because layered controls reduce the impact of one failed boundary.

## Build the access path

1. Create a tunnel from the home server.
2. Put identity-aware access in front of the route.
3. Restrict access to an explicit email allowlist.
4. Keep the application bound to the private network.

Map one hostname to one private service instead of exposing a broad reverse proxy dashboard. Use a stable internal target such as an application container name and port. Add the Access application before sharing the hostname, then confirm that its policy allows only the intended identities.

Remove the old router port forward after the tunnel works. Check that the service does not listen on a public interface. A DNS record should point to the tunnel provider, not to the home WAN address.

## Verify the result

- Confirm the origin port is closed from the internet.
- Confirm an unapproved account cannot pass the access policy.
- Confirm the service still works from an approved account.
- Confirm the application login still appears after the identity check.

Test from a device that is not connected to the home Wi-Fi. Use an approved account, an unapproved account, and a signed-out browser session. Then stop the connector and confirm that the public hostname fails closed instead of reaching a different origin.

> Remote access is not complete until both the public route and the blocked paths are tested.

## Keep the configuration recoverable

Export the tunnel and access policy settings with the rest of the homelab configuration. Record the hostname, private target, tunnel identifier, policy name, and allowed identities. Do not store reusable tokens in the article, screenshots, or repository.

Keep a rollback path. Remove the public hostname and DNS route first, then disable the connector. Restore a router port forward only as a temporary emergency measure and only after applying application authentication, transport encryption, and a narrow firewall rule.

Review the route after application upgrades or network changes. Retest the denied path whenever the identity provider, email allowlist, connector, reverse proxy, or local service address changes.`,
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

const actionableDraft = {
  ...validDraft,
  contentKind: 'tutorial',
  inlineImages: [
    {
      key: 'route-map',
      imagePath: '/tmp/route-map.png',
      alt: 'Request path from a remote browser through identity checks and a tunnel to a private homelab service.',
      caption: 'One public hostname maps to one private service through an authenticated tunnel.'
    },
    {
      key: 'verification-checks',
      imagePath: '/tmp/verification-checks.png',
      alt: 'Approved, denied, origin, and connector failure checks for a remote access route.',
      caption: 'A route is ready only after its allowed and blocked paths behave as expected.'
    }
  ],
  contentMarkdown: `${validDraft.contentMarkdown}

## Prerequisites before you start

Use a domain managed by the tunnel provider, an account that can create tunnels and access policies, and a host that can reach the private service. Choose a browser-based application for the first route. Native clients can fail when they cannot complete an interactive identity challenge, so test those clients separately before promising compatibility.

Record the private target before making changes. The target should include a stable host or container name and the exact internal port. Confirm that the connector host resolves that name and can reach the port without using the public hostname.

{{image:route-map}}

## Troubleshoot and rollback safely

If the hostname returns a gateway error, check the connector state and private target before changing DNS. If approved users loop at sign-in, inspect the Access application domain and policy order. If unapproved users reach the application, remove the public hostname immediately and correct the policy before restoring the route.

Rollback starts at the public edge. Remove or disable the hostname route, confirm that public DNS no longer reaches the application, and then stop the connector if it is no longer needed. Keep application authentication enabled throughout the change.

{{image:verification-checks}}

Document the successful route with its owner, hostname, private target, policy, and review date. Store secrets in a dedicated secret manager. Recheck the route after identity, DNS, connector, network, or application changes because each can alter the effective boundary.`
};

test('accepts a sourced homelab explainer with bounded product relevance', () => {
  const result = validateArticleDraft(validDraft, {
    repoRoot: new URL('../../..', import.meta.url).pathname
  });

  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('accepts an actionable tutorial with matched inline images', () => {
  const result = validateArticleDraft(actionableDraft, {
    repoRoot: new URL('../../..', import.meta.url).pathname
  });

  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('rejects actionable articles without enough inline images', () => {
  const result = validateArticleDraft({ ...actionableDraft, inlineImages: [] });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /two and five inline images/i);
});

test('rejects image placeholders that do not match the image contract', () => {
  const result = validateArticleDraft({
    ...actionableDraft,
    contentMarkdown: actionableDraft.contentMarkdown.replace('{{image:verification-checks}}', '{{image:missing-image}}')
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /matching \{\{image:key\}\} placeholder/i);
});

test('rejects promotional Stackarr headings', () => {
  const result = validateArticleDraft({
    ...validDraft,
    contentMarkdown: validDraft.contentMarkdown.replace('## Build the access path', '## Where Stackarr fits')
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /Stackarr in article headings/i);
});

test('rejects first-person experiential framing', () => {
  const result = validateArticleDraft({
    ...validDraft,
    title: 'How I Set Up My Home Server for Plex'
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /first-person/i);
});

test('rejects first-person framing outside a narrow verb list', () => {
  const result = validateArticleDraft({
    ...validDraft,
    contentMarkdown: validDraft.contentMarkdown.replace(
      'A public hostname should not create',
      'I connected every service in my lab, but a public hostname should not create'
    )
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

test('rejects repository evidence symlinks that resolve outside the repository', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'stackarr-blog-repo-'));
  const outsideDir = `${repoRoot}-outside`;
  await mkdir(outsideDir);
  const outsideFile = path.join(outsideDir, 'evidence.txt');
  await writeFile(outsideFile, 'Cloudflare access email allowlist', 'utf8');
  await symlink(outsideFile, path.join(repoRoot, 'evidence-link.txt'));

  try {
    const result = validateArticleDraft(
      {
        ...validDraft,
        productConnection: { ...validDraft.productConnection, evidencePaths: ['evidence-link.txt'] }
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

test('rejects an unrelated real file as product evidence', () => {
  const result = validateArticleDraft(
    {
      ...validDraft,
      productConnection: { ...validDraft.productConnection, evidencePaths: ['package.json'] }
    },
    { repoRoot: new URL('../../..', import.meta.url).pathname }
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /does not substantiate/i);
});

test('rejects a canonical URL that gives article authority to another site', () => {
  const result = validateArticleDraft({
    ...validDraft,
    seo: { canonicalUrl: 'https://example.com/copied-article' }
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /canonical URL/i);
});

test('requires a validated product connection for Stackarr mentions', () => {
  const result = validateArticleDraft({
    ...validDraft,
    productConnection: { relevant: false },
    contentMarkdown: `${validDraft.contentMarkdown}\n\nStackarr can simplify this route.`
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /without a validated product connection/i);
});

test('rejects reserved source hosts and mismatched primary-source publishers', () => {
  assert.throws(
    () =>
      validateSourceIdentity({
        kind: 'primary',
        publisher: 'Example',
        url: 'https://example.invalid/official-docs'
      }),
    /public HTTPS endpoint/i
  );
  assert.equal(publisherMatchesSource('Cloudflare', 'https://developers.cloudflare.com/cloudflare-one/'), true);
  assert.throws(
    () =>
      validateSourceIdentity({
        kind: 'primary',
        publisher: 'Cloudflare',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP'
      }),
    /publisher does not match/i
  );
});

test('accepts Markdown source documents with optional content-type parameters', () => {
  assert.equal(isSupportedSourceContentType('text/markdown'), true);
  assert.equal(isSupportedSourceContentType('text/markdown; charset=utf-8'), true);
});

test('rejects source addresses on blocked networks before fetching', async () => {
  await assert.rejects(
    verifyArticleSources({
      contentMarkdown: validDraft.contentMarkdown,
      sources: [
        {
          title: 'Local administration page',
          publisher: 'Local service',
          url: 'https://127.0.0.1/admin',
          kind: 'reference'
        }
      ]
    }),
    /blocked network/i
  );
});

test('detects long sentences copied verbatim from a source body', () => {
  const sentence =
    'A public hostname should never create a direct unauthenticated path to an administrative dashboard on the home network.';
  assert.deepEqual(findCopiedSentences(sentence, `<p>${sentence}</p>`), [
    'a public hostname should never create a direct unauthenticated path to an administrative dashboard on the home network'
  ]);
});

test('converts useful markdown structures into Portable Text', () => {
  const blocks = markdownToPortableText(validDraft.contentMarkdown);
  assert.ok(blocks.some((block) => block._type === 'block' && block.style === 'h2'));
  assert.ok(blocks.some((block) => block._type === 'block' && block.listItem === 'number'));
  assert.ok(blocks.some((block) => block._type === 'block' && block.listItem === 'bullet'));
  assert.ok(blocks.some((block) => block._type === 'callout'));
});

test('converts strong, emphasis, and inline code without exposing Markdown markers', () => {
  const blocks = markdownToPortableText(
    'Use **Cloudflare Access**, keep *application login* enabled, and test `requests.example.com`.'
  );
  const spans = blocks[0].children;

  assert.ok(spans.some((span) => span.text === 'Cloudflare Access' && span.marks.includes('strong')));
  assert.ok(spans.some((span) => span.text === 'application login' && span.marks.includes('em')));
  assert.ok(spans.some((span) => span.text === 'requests.example.com' && span.marks.includes('code')));
  assert.equal(
    spans.some((span) => /[*`]/.test(span.text)),
    false
  );
});

test('keeps reviewed local documentation links in the article body', () => {
  const blocks = markdownToPortableText(
    `${validDraft.contentMarkdown}\n\nRead the [Cloudflare integration guide](/docs/integrations/cloudflare).`
  );
  const localLink = blocks
    .flatMap((block) => block.markDefs ?? [])
    .find((mark) => mark.href === '/docs/integrations/cloudflare');

  assert.ok(localLink);
  assert.equal(localLink.blank, false);
});

test('converts inline image placeholders into referenced Portable Text images', () => {
  const blocks = markdownToPortableText(actionableDraft.contentMarkdown, [
    { key: 'route-map', assetId: 'image-route-map-100x100-png', alt: actionableDraft.inlineImages[0].alt },
    {
      key: 'verification-checks',
      assetId: 'image-verification-checks-100x100-png',
      alt: actionableDraft.inlineImages[1].alt,
      caption: actionableDraft.inlineImages[1].caption
    }
  ]);
  const images = blocks.filter((block) => block._type === 'image');

  assert.equal(images.length, 2);
  assert.equal(images[0].asset._ref, 'image-route-map-100x100-png');
  assert.equal(images[1].caption, actionableDraft.inlineImages[1].caption);
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
