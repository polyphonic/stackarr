import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@sanity/client';
import { markdownToPortableText, validateArticleDraft } from './lib/article-draft.mjs';

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error('Usage: node scripts/publish-article.mjs /absolute/path/to/article.json');
}

const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const configuredWorkDir = process.env.STACKARR_BLOG_WORK_DIR?.trim();
if (!configuredWorkDir || !path.isAbsolute(configuredWorkDir)) {
  throw new Error('STACKARR_BLOG_WORK_DIR must be an absolute temporary directory.');
}
const workDir = await realpath(configuredWorkDir);
const isInsideWorkDir = (candidate) => {
  const relative = path.relative(workDir, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const resolvedInputPath = await realpath(path.resolve(inputPath));
if (!isInsideWorkDir(resolvedInputPath)) {
  throw new Error('The article draft must be a regular file inside STACKARR_BLOG_WORK_DIR.');
}
const inputStats = await stat(resolvedInputPath);
if (!inputStats.isFile()) throw new Error('The article draft must be a regular file.');
const draft = JSON.parse(await readFile(resolvedInputPath, 'utf8'));
const validation = validateArticleDraft(draft, { repoRoot });
if (!validation.valid) {
  throw new Error(`Article validation failed:\n- ${validation.errors.join('\n- ')}`);
}
validation.warnings.forEach((warning) => console.warn(`Warning: ${warning}`));

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production';
const token = process.env.STACKARR_SANITY_API_TOKEN?.trim();
if (!(projectId && token)) {
  throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID and STACKARR_SANITY_API_TOKEN are required.');
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: '2026-08-10',
  useCdn: false,
  perspective: 'raw'
});
const publicClient = createClient({
  projectId,
  dataset,
  apiVersion: '2026-08-10',
  useCdn: false,
  perspective: 'published'
});

const publicId = `post-${draft.slug}`;
const collisions = await client.fetch(
  `*[_type == "post" && (_id == $id || _id == "drafts." + $id || slug.current == $slug || title == $title)]{_id}`,
  { id: publicId, slug: draft.slug, title: draft.title }
);
if (collisions.length) {
  throw new Error(`Publication collision detected for ${draft.slug}; no assets or documents were changed.`);
}

const categoryId = `category-${draft.categorySlug}`;
const support = await client.fetch(
  `{
    "category": *[_id == $categoryId && _type == "category"][0]._id,
    "author": *[_id == "author-stackarr-editorial" && _type == "author"][0]._id
  }`,
  { categoryId }
);
if (!(support.category && support.author)) {
  throw new Error('Run pnpm --filter @stackarr/cms taxonomy:seed before publishing.');
}

if (!draft.coverImagePath) {
  throw new Error('coverImagePath is required. Generate and review a relevant 16:9 editorial image first.');
}
const coverPath = path.resolve(draft.coverImagePath);
const resolvedCoverPath = await realpath(coverPath);
if (!isInsideWorkDir(resolvedCoverPath)) {
  throw new Error('coverImagePath must resolve to a file inside STACKARR_BLOG_WORK_DIR.');
}
const coverStats = await stat(resolvedCoverPath);
if (!coverStats.isFile() || coverStats.size < 1024 || coverStats.size > 15 * 1024 * 1024) {
  throw new Error('The cover image must be a regular file between 1 KB and 15 MB.');
}
const coverBytes = await readFile(resolvedCoverPath);
const extension = path.extname(resolvedCoverPath).toLowerCase();
const isPng = coverBytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
const isJpeg = coverBytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
const isWebp =
  coverBytes.subarray(0, 4).toString('ascii') === 'RIFF' && coverBytes.subarray(8, 12).toString('ascii') === 'WEBP';
if (
  !(
    (extension === '.png' && isPng) ||
    (['.jpg', '.jpeg'].includes(extension) && isJpeg) ||
    (extension === '.webp' && isWebp)
  )
) {
  throw new Error('The cover image extension and file signature must match PNG, JPEG, or WebP.');
}
const contentType =
  extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
const asset = await client.assets.upload('image', coverBytes, {
  filename: `${draft.slug}${extension || '.png'}`,
  contentType,
  title: draft.coverImageAlt
});
if (!(asset._id && asset.url)) {
  throw new Error('Sanity image upload did not return an asset ID and URL.');
}

const publishedAt = draft.publishedAt || new Date().toISOString();
const body = markdownToPortableText(draft.contentMarkdown);
const productConnection = draft.productConnection?.relevant
  ? {
      _type: 'productConnection',
      relevant: true,
      featureName: draft.productConnection.featureName,
      explanation: draft.productConnection.explanation,
      docsPath: draft.productConnection.docsPath
    }
  : { _type: 'productConnection', relevant: false };

const document = {
  _id: publicId,
  _type: 'post',
  title: draft.title.trim(),
  slug: { _type: 'slug', current: draft.slug },
  excerpt: draft.excerpt.trim(),
  category: { _type: 'reference', _ref: categoryId },
  coverImage: {
    _type: 'image',
    asset: { _type: 'reference', _ref: asset._id },
    alt: draft.coverImageAlt.trim(),
    caption: draft.coverImageCaption?.trim()
  },
  publishedAt,
  author: { _type: 'reference', _ref: 'author-stackarr-editorial' },
  contentKind: draft.contentKind || 'explainer',
  tags: draft.tags.map((tag) => tag.trim()),
  referencedServices: draft.referencedServices || [],
  body,
  sources: draft.sources.map((source, index) => ({
    _type: 'sourceCitation',
    _key: `source-${index + 1}`,
    title: source.title.trim(),
    publisher: source.publisher.trim(),
    url: source.url,
    kind: source.kind
  })),
  productConnection,
  featured: Boolean(draft.featured),
  seo: {
    _type: 'seoMetadata',
    title: draft.seo?.title || draft.title,
    description: draft.seo?.description || draft.excerpt,
    canonicalUrl: draft.seo?.canonicalUrl,
    noIndex: false,
    openGraphTitle: draft.seo?.openGraphTitle || draft.title,
    openGraphDescription: draft.seo?.openGraphDescription || draft.excerpt
  }
};

let documentCreated = false;
let verified;
try {
  await client.create(document, { visibility: 'sync' });
  documentCreated = true;
  verified = await publicClient.fetch(
    `*[_id == $id && _type == "post" && slug.current == $slug][0]{_id, "slug": slug.current, title, "imageUrl": coverImage.asset->url}`,
    { id: publicId, slug: draft.slug }
  );
  if (!(verified?._id === publicId && verified?.imageUrl)) {
    throw new Error(`Published document ${publicId} was not publicly readable after the mutation.`);
  }
} catch (error) {
  if (!documentCreated) {
    try {
      await client.delete(asset._id);
    } catch {
      console.warn(`Warning: could not remove unreferenced image asset ${asset._id}.`);
    }
  }
  throw error;
}

console.log(
  JSON.stringify(
    {
      published: true,
      id: verified._id,
      slug: verified.slug,
      title: verified.title,
      imageUrl: verified.imageUrl,
      expectedUrl: `https://stackarr.app/blog/${verified.slug}`
    },
    null,
    2
  )
);
