import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@sanity/client';
import { markdownToPortableText, validateArticleDraft } from './lib/article-draft.mjs';
import { validateCategoryFreshness } from './lib/publisher-policy.mjs';
import { verifyArticleSources } from './lib/source-verification.mjs';

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
const categoryId = `category-${draft.categorySlug}`;
const [collisions, support, existingPosts, verifiedSources] = await Promise.all([
  client.fetch(
    `*[_type == "post" && (_id == $id || _id == "drafts." + $id || slug.current == $slug || title == $title)]{_id}`,
    { id: publicId, slug: draft.slug, title: draft.title.trim() }
  ),
  client.fetch(
    `{
      "category": *[_id == $categoryId && _type == "category"][0]._id,
      "author": *[_id == "author-stackarr-editorial" && _type == "author"][0]._id
    }`,
    { categoryId }
  ),
  client.fetch(
    `*[_type == "post" && !(_id in path("drafts.**"))] | order(publishedAt desc)[0...200]{
      title,
      "categorySlug": category->slug.current
    }`
  ),
  verifyArticleSources(draft)
]);
if (collisions.length) {
  throw new Error(`Publication collision detected for ${draft.slug}; no assets or documents were changed.`);
}
if (!(support.category && support.author)) {
  throw new Error('Run pnpm --filter @stackarr/cms taxonomy:seed before publishing.');
}
const categoryFreshness = validateCategoryFreshness(draft.categorySlug, existingPosts);
if (!categoryFreshness.valid) {
  throw new Error(
    `Category ${draft.categorySlug} was used by one of the two most recent articles. Choose a fresh category; no assets or documents were changed.`
  );
}
const originalityValidation = validateArticleDraft(
  {
    ...draft,
    discoveryHeadlines: [
      ...(Array.isArray(draft.discoveryHeadlines) ? draft.discoveryHeadlines : []),
      ...existingPosts.map((post) => post.title),
      ...verifiedSources.flatMap((source) => source.headlines)
    ]
  },
  { repoRoot }
);
if (!originalityValidation.valid) {
  throw new Error(`Article originality validation failed:\n- ${originalityValidation.errors.join('\n- ')}`);
}
const verifiedSourceUrls = new Map(verifiedSources.map((source) => [source.source.url, source.finalUrl]));

async function resolveArticleImage(imagePath, label) {
  if (!imagePath) throw new Error(`${label} imagePath is required.`);
  const resolvedPath = await realpath(path.resolve(imagePath));
  if (!isInsideWorkDir(resolvedPath)) {
    throw new Error(`${label} imagePath must resolve to a file inside STACKARR_BLOG_WORK_DIR.`);
  }
  const imageStats = await stat(resolvedPath);
  if (!imageStats.isFile() || imageStats.size < 1024 || imageStats.size > 15 * 1024 * 1024) {
    throw new Error(`${label} image must be a regular file between 1 KB and 15 MB.`);
  }

  const bytes = await readFile(resolvedPath);
  const extension = path.extname(resolvedPath).toLowerCase();
  const isPng = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  const isWebp =
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (
    !(
      (extension === '.png' && isPng) ||
      (['.jpg', '.jpeg'].includes(extension) && isJpeg) ||
      (extension === '.webp' && isWebp)
    )
  ) {
    throw new Error(`${label} image extension and file signature must match PNG, JPEG, or WebP.`);
  }

  return {
    bytes,
    extension,
    contentType:
      extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png'
  };
}

if (!draft.coverImagePath) {
  throw new Error('coverImagePath is required. Generate and review a relevant 16:9 editorial image first.');
}
const imageInputs = [
  {
    key: 'cover',
    imagePath: draft.coverImagePath,
    alt: draft.coverImageAlt.trim(),
    caption: draft.coverImageCaption?.trim(),
    filenameBase: draft.slug
  },
  ...(draft.inlineImages || []).map((image) => ({
    key: image.key,
    imagePath: image.imagePath,
    alt: image.alt.trim(),
    caption: image.caption?.trim(),
    filenameBase: `${draft.slug}-${image.key}`
  }))
];
const preparedImages = await Promise.all(
  imageInputs.map(async (image) => ({ ...image, ...(await resolveArticleImage(image.imagePath, image.key)) }))
);

const uploadedAssets = [];
let documentCreated = false;
async function rollbackPublication() {
  if (documentCreated) {
    try {
      await client.delete(publicId, { visibility: 'sync' });
    } catch {
      console.warn(`Warning: could not roll back document ${publicId}.`);
    }
  }
  for (const uploaded of [...uploadedAssets].reverse()) {
    try {
      await client.delete(uploaded.assetId, { visibility: 'sync' });
    } catch {
      console.warn(`Warning: could not remove image asset ${uploaded.assetId}.`);
    }
  }
}

let verified;
try {
  for (const image of preparedImages) {
    const asset = await client.assets.upload('image', image.bytes, {
      filename: `${image.filenameBase}${image.extension}`,
      contentType: image.contentType,
      title: image.alt
    });
    if (!(asset._id && asset.url)) {
      throw new Error(`Sanity image upload for ${image.key} did not return an asset ID and URL.`);
    }
    uploadedAssets.push({
      key: image.key,
      assetId: asset._id,
      url: asset.url,
      alt: image.alt,
      caption: image.caption
    });
  }

  const coverAsset = uploadedAssets.find((asset) => asset.key === 'cover');
  if (!coverAsset) throw new Error('The cover image was not uploaded.');
  const inlineAssets = uploadedAssets.filter((asset) => asset.key !== 'cover');
  const publishedAt = draft.publishedAt || new Date().toISOString();
  const body = markdownToPortableText(draft.contentMarkdown, inlineAssets);
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
      asset: { _type: 'reference', _ref: coverAsset.assetId },
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
      url: verifiedSourceUrls.get(source.url) || source.url,
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

  await client.create(document, { visibility: 'sync' });
  documentCreated = true;
  verified = await publicClient.fetch(
    `*[_id == $id && _type == "post" && slug.current == $slug][0]{
      _id,
      "slug": slug.current,
      title,
      "imageUrl": coverImage.asset->url,
      "inlineImageCount": count(body[_type == "image" && defined(asset->url)])
    }`,
    { id: publicId, slug: draft.slug }
  );
  if (!(verified?._id === publicId && verified?.imageUrl && verified.inlineImageCount === inlineAssets.length)) {
    throw new Error(`Published document ${publicId} was not publicly readable with all images after the mutation.`);
  }
} catch (error) {
  await rollbackPublication();
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
      inlineImageCount: verified.inlineImageCount,
      expectedUrl: `https://stackarr.app/blog/${verified.slug}`
    },
    null,
    2
  )
);
