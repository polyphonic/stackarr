import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../../editorial.config.json', import.meta.url));
const editorialConfig = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) => readFile(configPath, 'utf8'))
);

const CATEGORY_SLUGS = new Set(editorialConfig.categories.map((category) => category.slug));
const FIRST_PERSON_EXPERIENCE_RE = /\b(?:i|i['’](?:d|m|ve)|me|mine|my|our|ours|us|we|we['’](?:d|re|ve))\b/i;
const HOMELAB_SIGNAL_RE =
  /\b(?:arr\s+stack|backup|cloudflare|container|docker|home\s+server|homelab|immich|jellyfin|media\s+server|mcp|nas|network|plex|private\s+cloud|radarr|remote\s+access|romm|self-host(?:ed|ing)|smart\s+home|sonarr|storage|tunnel|virtuali[sz]ation)\b/gi;
const OFF_NICHE_RE = /\b(?:celebrity|fashion|horoscope|makeup|political\s+campaign|stock\s+tip|weight\s+loss)\b/i;
const HTTPS_URL_RE = /^https:\/\/[^\s]+$/;
const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INLINE_IMAGE_PLACEHOLDER_RE = /^\{\{image:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}$/;
const INLINE_IMAGE_PLACEHOLDER_GLOBAL_RE = /^\{\{image:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}$/gm;
const INLINE_MARK_RE =
  /\[([^\]]+)\]\((https:\/\/[^\s)]+|\/docs\/[a-z0-9/_-]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
const SOURCE_KINDS = new Set(['primary', 'reference', 'discovery']);
const CONTENT_KINDS = new Set(['explainer', 'tutorial', 'checklist', 'comparison', 'troubleshooting', 'security']);
const ACTIONABLE_CONTENT_KINDS = new Set(['tutorial', 'troubleshooting', 'security']);
const REQUIRED_ACTIONABLE_SECTIONS = [
  { label: 'prerequisites', pattern: /\b(?:before you start|prerequisites?|requirements?)\b/i },
  { label: 'setup', pattern: /\b(?:build|configure|create|install|set up|setup)\b/i },
  { label: 'verification', pattern: /\b(?:check|test|verify|verification)\b/i },
  { label: 'recovery', pattern: /\b(?:recover|rollback|troubleshoot|undo)\b/i }
];
const CLAIM_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'before',
  'between',
  'could',
  'creates',
  'from',
  'have',
  'into',
  'needs',
  'setup',
  'stackarr',
  'their',
  'there',
  'these',
  'this',
  'through',
  'with',
  'would'
]);

function uniqueKey(prefix, value, index) {
  return `${prefix}-${createHash('sha1').update(`${index}:${value}`).digest('hex').slice(0, 10)}`;
}

function normalizedTokens(value) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function headlineSimilarity(left, right) {
  const leftTokens = normalizedTokens(left);
  const rightTokens = normalizedTokens(right);
  if (!(leftTokens.size && rightTokens.size)) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function countWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function countPlaceholders(markdown) {
  return [...markdown.matchAll(INLINE_IMAGE_PLACEHOLDER_GLOBAL_RE)].map((match) => match[1]);
}

function plainMarkdown(value) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ');
}

function resolveContainedFile(root, candidate) {
  try {
    const realRoot = realpathSync(root);
    const realFile = realpathSync(path.resolve(realRoot, candidate));
    const relativePath = path.relative(realRoot, realFile);
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath) ||
      !statSync(realFile).isFile()
    ) {
      return null;
    }
    return realFile;
  } catch {
    return null;
  }
}

function claimTokens(value) {
  return [...normalizedTokens(value)].filter((token) => token.length >= 4 && !CLAIM_STOP_WORDS.has(token));
}

function textSupportsClaim(text, tokens) {
  const evidenceTokens = normalizedTokens(text);
  const matchingTokens = tokens.filter((token) => evidenceTokens.has(token));
  return matchingTokens.length >= Math.min(2, tokens.length);
}

export function validateArticleDraft(draft, options = {}) {
  const errors = [];
  const warnings = [];
  const title = String(draft?.title ?? '').trim();
  const excerpt = String(draft?.excerpt ?? '').trim();
  const markdown = String(draft?.contentMarkdown ?? '').trim();
  const combinedCopy = `${title}\n${excerpt}\n${plainMarkdown(markdown)}`;
  const nicheSignals = combinedCopy.match(HOMELAB_SIGNAL_RE) ?? [];

  if (
    typeof draft?.title !== 'string' ||
    typeof draft?.excerpt !== 'string' ||
    typeof draft?.contentMarkdown !== 'string'
  ) {
    errors.push('Title, excerpt, and article body must be strings.');
  }
  if (!title || title.length > 85) errors.push('Title is required and must be 85 characters or fewer.');
  if (!SAFE_SLUG_RE.test(String(draft?.slug ?? ''))) errors.push('Slug must use lowercase words separated by hyphens.');
  if (!excerpt || excerpt.length > 180) errors.push('Excerpt is required and must be 180 characters or fewer.');
  if (!CATEGORY_SLUGS.has(draft?.categorySlug)) errors.push('Category must be one of the approved homelab categories.');
  const contentKind = draft?.contentKind || 'explainer';
  if (!CONTENT_KINDS.has(contentKind)) errors.push('Content kind must be one of the approved editorial formats.');
  const tags = Array.isArray(draft?.tags) ? draft.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  if (
    !Array.isArray(draft?.tags) ||
    draft.tags.some((tag) => typeof tag !== 'string') ||
    tags.length < 2 ||
    tags.length > 8 ||
    new Set(tags.map((tag) => tag.toLowerCase())).size !== tags.length
  ) {
    errors.push('Draft must include between two and eight unique tags.');
  }
  if (tags.some((tag) => tag.length > 48)) errors.push('Each tag must be 48 characters or fewer.');
  const coverImageAlt = String(draft?.coverImageAlt ?? '').trim();
  if (typeof draft?.coverImageAlt !== 'string' || !coverImageAlt || coverImageAlt.length > 160) {
    errors.push('Cover image alt text is required and must be 160 characters or fewer.');
  }
  if (
    draft?.coverImageCaption !== undefined &&
    (typeof draft.coverImageCaption !== 'string' || draft.coverImageCaption.length > 240)
  ) {
    errors.push('Cover image caption must be a string of 240 characters or fewer.');
  }
  if (draft?.publishedAt !== undefined) {
    const publishedAt = typeof draft.publishedAt === 'string' ? Date.parse(draft.publishedAt) : Number.NaN;
    if (!Number.isFinite(publishedAt) || publishedAt > Date.now()) {
      errors.push('publishedAt must be a valid date that is not in the future.');
    }
  }
  if (FIRST_PERSON_EXPERIENCE_RE.test(combinedCopy)) errors.push('First-person experiential framing is not allowed.');
  if (OFF_NICHE_RE.test(combinedCopy) || new Set(nicheSignals.map((signal) => signal.toLowerCase())).size < 3) {
    errors.push('Draft must remain inside the homelab niche, including self-hosting or home-server operations.');
  }
  const articleWordCount = countWords(plainMarkdown(markdown));
  const sectionHeadings = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]);
  const numberedStepCount = (markdown.match(/^\d+\.\s+/gm) ?? []).length;
  if (articleWordCount < (ACTIONABLE_CONTENT_KINDS.has(contentKind) ? 650 : 300)) {
    errors.push(
      ACTIONABLE_CONTENT_KINDS.has(contentKind)
        ? 'Tutorial, security, and troubleshooting articles must contain at least 650 useful words.'
        : 'Article body must contain at least 300 useful words.'
    );
  }
  if (sectionHeadings.length < (ACTIONABLE_CONTENT_KINDS.has(contentKind) ? 6 : 4)) {
    errors.push(
      ACTIONABLE_CONTENT_KINDS.has(contentKind)
        ? 'Tutorial, security, and troubleshooting articles must contain at least six H2 sections.'
        : 'Article body must contain at least four H2 sections.'
    );
  }
  if (!(markdown.match(/^(?:-|\d+\.)\s+/gm) ?? []).length) {
    errors.push('Article body must include at least one useful list.');
  }
  if (ACTIONABLE_CONTENT_KINDS.has(contentKind)) {
    if (numberedStepCount < 4) errors.push('Actionable articles must contain at least four numbered setup steps.');
    for (const requiredSection of REQUIRED_ACTIONABLE_SECTIONS) {
      if (!sectionHeadings.some((heading) => requiredSection.pattern.test(heading))) {
        errors.push(`Actionable articles need a clear ${requiredSection.label} section.`);
      }
    }
  }
  if (sectionHeadings.some((heading) => /\bstackarr\b/i.test(heading))) {
    errors.push('Do not use Stackarr in article headings. Keep any verified product reference inside a useful step.');
  }

  const inlineImages = Array.isArray(draft?.inlineImages) ? draft.inlineImages : [];
  const placeholderKeys = countPlaceholders(markdown);
  const imageKeys = inlineImages.map((image) => image?.key);
  const requiredImageCount = ACTIONABLE_CONTENT_KINDS.has(contentKind) ? 2 : 0;
  if (inlineImages.length < requiredImageCount || inlineImages.length > 5) {
    errors.push(
      ACTIONABLE_CONTENT_KINDS.has(contentKind)
        ? 'Tutorial, security, and troubleshooting articles need between two and five inline images.'
        : 'Articles may include no more than five inline images.'
    );
  }
  if (new Set(imageKeys).size !== imageKeys.length) errors.push('Inline image keys must be unique.');
  for (const image of inlineImages) {
    if (
      !(
        typeof image?.key === 'string' &&
        SAFE_SLUG_RE.test(image.key) &&
        typeof image?.imagePath === 'string' &&
        image.imagePath.trim() &&
        typeof image?.alt === 'string' &&
        image.alt.trim() &&
        image.alt.length <= 160 &&
        (image.caption === undefined || (typeof image.caption === 'string' && image.caption.length <= 240))
      )
    ) {
      errors.push('Every inline image needs a safe key, imagePath, alt text, and an optional caption within limits.');
      break;
    }
  }
  if (new Set(placeholderKeys).size !== placeholderKeys.length) {
    errors.push('Each inline image placeholder must appear exactly once.');
  }
  if (
    placeholderKeys.some((key) => !imageKeys.includes(key)) ||
    imageKeys.some((key) => placeholderKeys.filter((placeholderKey) => placeholderKey === key).length !== 1)
  ) {
    errors.push('Every inline image must have exactly one matching {{image:key}} placeholder in the article body.');
  }

  const sources = Array.isArray(draft?.sources) ? draft.sources : [];
  const primarySources = sources.filter((source) => source?.kind === 'primary');
  if (sources.length < 3) errors.push('Article must include at least three sources.');
  if (sources.length > 12) errors.push('Article must include no more than twelve sources.');
  if (primarySources.length < 2) errors.push('Article must include at least two primary or official sources.');
  if (new Set(sources.map((source) => source?.url)).size !== sources.length) {
    errors.push('Article sources must use unique URLs.');
  }
  for (const source of sources) {
    if (
      !(
        source?.title &&
        source?.publisher &&
        typeof source.title === 'string' &&
        typeof source.publisher === 'string' &&
        typeof source.url === 'string' &&
        HTTPS_URL_RE.test(String(source?.url ?? '')) &&
        SOURCE_KINDS.has(source?.kind)
      )
    ) {
      errors.push('Every source needs a title, publisher, approved kind, and HTTPS URL.');
      break;
    }
  }

  const discoveryHeadlines = Array.isArray(draft?.discoveryHeadlines) ? draft.discoveryHeadlines : [];
  if (discoveryHeadlines.some((headline) => headlineSimilarity(title, String(headline)) >= 0.72)) {
    errors.push('Draft title is too close to a discovery-source headline.');
  }
  if (
    sectionHeadings.some((heading) =>
      discoveryHeadlines.some((sourceHeading) => headlineSimilarity(heading, String(sourceHeading)) >= 0.82)
    )
  ) {
    errors.push('Draft section structure is too close to a discovery source.');
  }

  const services = Array.isArray(draft?.referencedServices) ? draft.referencedServices : [];
  if (
    services.length > 5 ||
    new Set(services).size !== services.length ||
    services.some((slug) => typeof slug !== 'string' || !SAFE_SLUG_RE.test(slug))
  ) {
    errors.push('Referenced services must contain no more than five unique safe service slugs.');
  }
  if (options.repoRoot) {
    const catalogPath = path.join(options.repoRoot, 'apps/docs/src/lib/service-integrations.ts');
    const catalogSource = existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8') : '';
    const catalogSlugs = new Set([...catalogSource.matchAll(/\bslug:\s*'([^']+)'/g)].map((match) => match[1]));
    if (services.some((serviceSlug) => !catalogSlugs.has(serviceSlug))) {
      errors.push('Referenced services must exist in the local Stackarr integration catalog.');
    }
  }

  const expectedCanonicalUrl = `https://stackarr.app/blog/${draft?.slug ?? ''}`;
  if (draft?.seo?.canonicalUrl && draft.seo.canonicalUrl !== expectedCanonicalUrl) {
    errors.push(`Canonical URL must be ${expectedCanonicalUrl}.`);
  }
  const seoStringFields = ['title', 'description', 'canonicalUrl', 'openGraphTitle', 'openGraphDescription'];
  if (seoStringFields.some((field) => draft?.seo?.[field] !== undefined && typeof draft.seo[field] !== 'string')) {
    errors.push('SEO fields must contain strings.');
  }
  if (String(draft?.seo?.title ?? '').length > 65) errors.push('SEO title must be 65 characters or fewer.');
  if (String(draft?.seo?.description ?? '').length > 160)
    errors.push('SEO description must be 160 characters or fewer.');
  if (String(draft?.seo?.openGraphDescription ?? '').length > 200) {
    errors.push('Open Graph description must be 200 characters or fewer.');
  }

  const stackarrMentions = (combinedCopy.match(/\bstackarr\b/gi) ?? []).length;
  if (stackarrMentions > 2) errors.push('Product promotion is too frequent. Limit Stackarr to two useful mentions.');

  if (draft?.productConnection?.relevant) {
    const connection = draft.productConnection;
    if (
      !(
        typeof connection.featureName === 'string' &&
        connection.featureName.trim() &&
        typeof connection.explanation === 'string' &&
        connection.explanation.trim() &&
        typeof connection.docsPath === 'string' &&
        connection.docsPath.trim()
      )
    ) {
      errors.push('A relevant Stackarr connection needs a feature name, explanation, and docs path.');
    }
    if (!String(connection.docsPath ?? '').startsWith('/docs/')) {
      errors.push('Stackarr docsPath must point to a local /docs/ route.');
    }
    const evidencePaths = Array.isArray(connection.evidencePaths) ? connection.evidencePaths : [];
    if (!evidencePaths.length) errors.push('Stackarr feature claims require repository evidence paths.');
    if (options.repoRoot) {
      const repoRoot = realpathSync(options.repoRoot);
      const evidenceFiles = [];
      for (const evidencePath of evidencePaths) {
        const evidenceFile = resolveContainedFile(repoRoot, evidencePath);
        if (!evidenceFile) {
          errors.push(`Stackarr feature evidence does not exist: ${evidencePath}`);
        } else {
          evidenceFiles.push(evidenceFile);
        }
      }
      const docsRelativePath = String(connection.docsPath ?? '').slice('/docs/'.length);
      const docsRoot = path.join(repoRoot, 'apps/docs/content/docs');
      const docsFile = docsRelativePath ? resolveContainedFile(docsRoot, `${docsRelativePath}.mdx`) : null;
      if (!docsFile) {
        errors.push(`Stackarr product connection needs a published docs page: ${connection.docsPath}`);
      }
      const featureClaim = `${connection.featureName ?? ''} ${connection.explanation ?? ''}`;
      const featureTokens = claimTokens(featureClaim);
      const evidenceText = evidenceFiles.map((file) => readFileSync(file, 'utf8').slice(0, 1_000_000)).join('\n');
      if (!featureTokens.length || !textSupportsClaim(evidenceText, featureTokens)) {
        errors.push('Repository evidence does not substantiate the stated Stackarr feature.');
      }
      if (docsFile && !textSupportsClaim(readFileSync(docsFile, 'utf8').slice(0, 1_000_000), featureTokens)) {
        errors.push('The linked Stackarr documentation does not substantiate the stated feature.');
      }
    }
  } else if (stackarrMentions) {
    errors.push('Article mentions Stackarr without a validated product connection.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

function inlineChildren(text, blockIndex) {
  const children = [];
  const markDefs = [];
  let cursor = 0;
  let match;
  let linkIndex = 0;
  INLINE_MARK_RE.lastIndex = 0;

  const addSpan = (spanText, marks = []) => {
    if (!spanText) return;
    children.push({
      _type: 'span',
      _key: uniqueKey('span', spanText, children.length + blockIndex),
      marks,
      text: spanText
    });
  };

  while ((match = INLINE_MARK_RE.exec(text))) {
    if (match.index > cursor) addSpan(text.slice(cursor, match.index));

    if (match[1] && match[2]) {
      const markKey = uniqueKey('link', match[2], blockIndex + linkIndex);
      markDefs.push({ _type: 'link', _key: markKey, href: match[2], blank: match[2].startsWith('https://') });
      addSpan(match[1], [markKey]);
      linkIndex += 1;
    } else if (match[3]) {
      addSpan(match[3], ['strong']);
    } else if (match[4]) {
      addSpan(match[4], ['code']);
    } else if (match[5]) {
      addSpan(match[5], ['em']);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length || !children.length) addSpan(text.slice(cursor));

  return { children, markDefs };
}

function textBlock(text, style, index, listItem) {
  const inline = inlineChildren(text, index);
  return {
    _type: 'block',
    _key: uniqueKey('block', `${style}:${text}`, index),
    style,
    ...(listItem ? { level: 1, listItem } : {}),
    ...inline
  };
}

export function markdownToPortableText(markdown, inlineAssets = []) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const assetByKey = new Map(inlineAssets.map((asset) => [asset.key, asset]));
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const imagePlaceholder = line.match(INLINE_IMAGE_PLACEHOLDER_RE);
    if (imagePlaceholder) {
      const image = assetByKey.get(imagePlaceholder[1]);
      if (!(image?.assetId && image?.alt)) {
        throw new Error(`Inline image placeholder ${imagePlaceholder[1]} does not have an uploaded asset.`);
      }
      blocks.push({
        _type: 'image',
        _key: uniqueKey('image', image.key, blocks.length),
        asset: { _type: 'reference', _ref: image.assetId },
        alt: image.alt,
        ...(image.caption ? { caption: image.caption } : {})
      });
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || 'text';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({
        _type: 'codeBlock',
        _key: uniqueKey('code', codeLines.join('\n'), blocks.length),
        code: codeLines.join('\n'),
        language
      });
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      blocks.push(textBlock(heading[2], `h${heading[1].length}`, blocks.length));
      index += 1;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      blocks.push(textBlock(bullet[1], 'normal', blocks.length, 'bullet'));
      index += 1;
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      blocks.push(textBlock(numbered[1], 'normal', blocks.length, 'number'));
      index += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      const first = quoteLines.shift() ?? '';
      const calloutMatch = first.match(/^\[!(NOTE|TIP|WARNING)\]\s*(.*)$/i);
      blocks.push({
        _type: 'callout',
        _key: uniqueKey('callout', quoteLines.join(' ') || first, blocks.length),
        tone: calloutMatch?.[1]?.toLowerCase() === 'warning' ? 'warning' : 'info',
        title: calloutMatch?.[2] || undefined,
        body: (calloutMatch ? quoteLines : [first, ...quoteLines]).join(' ')
      });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(?:#{2,4}\s+|[-*]\s+|\d+\.\s+|>|```|\{\{image:)/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(textBlock(paragraph.join(' '), 'normal', blocks.length));
  }

  return blocks;
}
