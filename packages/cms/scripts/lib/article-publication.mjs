import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { markdownToPortableText, validateArticleDraft } from './article-draft.mjs';
import { validateCategoryFreshness } from './publisher-policy.mjs';
import { verifyArticleSources } from './source-verification.mjs';

const PROJECT_ID_RE = /^[a-z0-9-]+$/;
const DATASET_RE = /^(?:~[a-z0-9][a-z0-9_-]{0,63}|[a-z0-9][a-z0-9_-]{0,63})$/;
const PUBLIC_POST_ID_RE = /^post-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_ASSET_ID_RE = /^image-[a-zA-Z0-9]+-\d+x\d+-[a-z0-9]+$/;
const SAFE_IMAGE_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertMcpResource(resource) {
  if (!PROJECT_ID_RE.test(resource?.projectId ?? '') || !DATASET_RE.test(resource?.dataset ?? '')) {
    throw new Error('A valid Sanity MCP project ID and dataset are required.');
  }
}

async function resolveWorkDirectory(workDir) {
  if (!workDir || !path.isAbsolute(workDir)) {
    throw new Error('STACKARR_BLOG_WORK_DIR must be an absolute temporary directory.');
  }
  return realpath(workDir);
}

function isInsideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function resolveContainedFile(workDir, candidate, errorPrefix) {
  const resolvedPath = await realpath(path.resolve(candidate));
  if (!isInsideDirectory(workDir, resolvedPath)) {
    throw new Error(`${errorPrefix} must be a regular file inside STACKARR_BLOG_WORK_DIR.`);
  }
  const fileStats = await stat(resolvedPath);
  if (!fileStats.isFile()) throw new Error(`${errorPrefix} must be a regular file.`);
  return { fileStats, resolvedPath };
}

async function resolveArticleImage(workDir, imagePath, label) {
  if (!imagePath) throw new Error(`${label} imagePath is required.`);
  const { fileStats, resolvedPath } = await resolveContainedFile(workDir, imagePath, `${label} imagePath`);
  if (fileStats.size < 1024 || fileStats.size > 15 * 1024 * 1024) {
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

async function removeUploadedAssets(client, uploadedAssets) {
  const failures = [];
  for (const uploaded of uploadedAssets) {
    try {
      await client.delete(uploaded.assetId, { visibility: 'sync' });
    } catch (error) {
      failures.push(new Error(`Could not delete ${uploaded.assetId} during asset cleanup.`, { cause: error }));
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Asset cleanup did not remove every uploaded image.');
  }
}

export async function readPublicationPreparation({ preparationPath, workDir }) {
  const resolvedWorkDir = await resolveWorkDirectory(workDir);
  const { resolvedPath } = await resolveContainedFile(
    resolvedWorkDir,
    preparationPath,
    'The publication preparation file'
  );
  return JSON.parse(await readFile(resolvedPath, 'utf8'));
}

export async function prepareArticlePublication({
  client,
  draftPath,
  now = () => new Date(),
  publicClient,
  repoRoot,
  resource,
  verifySources = verifyArticleSources,
  warn = console.warn,
  workDir
}) {
  assertMcpResource(resource);
  const resolvedWorkDir = await resolveWorkDirectory(workDir);
  const { resolvedPath: resolvedDraftPath } = await resolveContainedFile(
    resolvedWorkDir,
    draftPath,
    'The article draft'
  );
  const draft = JSON.parse(await readFile(resolvedDraftPath, 'utf8'));
  const validation = validateArticleDraft(draft, { repoRoot });
  if (!validation.valid) {
    throw new Error(`Article validation failed:\n- ${validation.errors.join('\n- ')}`);
  }
  validation.warnings.forEach((warning) => warn(`Warning: ${warning}`));

  const publicId = `post-${draft.slug}`;
  const categoryId = `category-${draft.categorySlug}`;
  const [collisions, support, existingPosts, recentPublicPosts, verifiedSources] = await Promise.all([
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
    client.fetch(`*[_type == "post" && !(_id in path("drafts.**"))] | order(publishedAt desc)[0...200]{title}`),
    publicClient.fetch(
      `*[
        _type == "post" &&
        publishedAt <= now() &&
        !coalesce(seo.noIndex, false)
      ] | order(publishedAt desc)[0...2]{
        "categorySlug": category->slug.current
      }`
    ),
    verifySources(draft)
  ]);
  if (collisions.length) {
    throw new Error(`Publication collision detected for ${draft.slug}; no assets or documents were changed.`);
  }
  if (!(support.category && support.author)) {
    throw new Error('Run pnpm --filter @stackarr/cms taxonomy:seed before publishing.');
  }
  const categoryFreshness = validateCategoryFreshness(draft.categorySlug, recentPublicPosts);
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
    imageInputs.map(async (image) => ({
      ...image,
      ...(await resolveArticleImage(resolvedWorkDir, image.imagePath, image.key))
    }))
  );

  const uploadedAssets = [];
  try {
    for (const image of preparedImages) {
      const filename = `${image.filenameBase}${image.extension}`;
      const asset = await client.assets.upload('image', image.bytes, {
        filename,
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
    const publishedAt = draft.publishedAt || now().toISOString();
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

    const documentContent = {
      _id: publicId,
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
    const mcpResource = { projectId: resource.projectId, dataset: resource.dataset };

    return {
      createDocuments: {
        resource: mcpResource,
        documents: [{ type: 'post', content: documentContent }]
      },
      publishDocuments: {
        resource: mcpResource,
        ids: [publicId]
      },
      cleanup: {
        version: 1,
        publicId,
        draftId: `drafts.${publicId}`,
        uploadedAssets
      },
      verification: {
        publicId,
        slug: draft.slug,
        expectedUrl: `https://stackarr.app/blog/${draft.slug}`,
        coverAssetId: coverAsset.assetId,
        inlineImageCount: inlineAssets.length
      }
    };
  } catch (error) {
    try {
      await removeUploadedAssets(client, [...uploadedAssets].reverse());
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Article preparation failed and uploaded assets could not be fully removed.'
      );
    }
    throw error;
  }
}

function cleanupTargets(preparation) {
  const cleanup = preparation?.cleanup;
  const createDocuments = preparation?.createDocuments;
  const publishDocuments = preparation?.publishDocuments;
  const publicId = cleanup?.publicId;
  const draftId = cleanup?.draftId;
  const uploadedAssets = cleanup?.uploadedAssets;
  const createDocument = createDocuments?.documents?.[0];

  assertMcpResource(createDocuments?.resource);
  assertMcpResource(publishDocuments?.resource);
  if (
    cleanup?.version !== 1 ||
    !PUBLIC_POST_ID_RE.test(publicId ?? '') ||
    draftId !== `drafts.${publicId}` ||
    createDocuments.documents.length !== 1 ||
    createDocument?.type !== 'post' ||
    createDocument?.content?._id !== publicId ||
    publishDocuments.ids?.length !== 1 ||
    publishDocuments.ids[0] !== publicId ||
    createDocuments.resource.projectId !== publishDocuments.resource.projectId ||
    createDocuments.resource.dataset !== publishDocuments.resource.dataset ||
    !Array.isArray(uploadedAssets) ||
    !uploadedAssets.length
  ) {
    throw new Error('The publication cleanup manifest does not match one prepared post.');
  }

  const assetIds = [];
  for (const asset of uploadedAssets) {
    if (!SAFE_IMAGE_KEY_RE.test(asset?.key ?? '') || !IMAGE_ASSET_ID_RE.test(asset?.assetId ?? '')) {
      throw new Error('The publication cleanup manifest contains an invalid image asset.');
    }
    assetIds.push(asset.assetId);
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw new Error('The publication cleanup manifest contains duplicate image assets.');
  }

  return {
    documentIds: [draftId, publicId],
    assetIds: assetIds.reverse()
  };
}

export async function cleanupPreparedArticleAssets({ client, preparation }) {
  const targets = cleanupTargets(preparation);
  const uploadedAssets = targets.assetIds.map((assetId) => ({ assetId }));
  await removeUploadedAssets(client, uploadedAssets);
  return { cleaned: true, assetIds: targets.assetIds };
}

export async function cleanupArticlePublication({ client, preparation }) {
  const targets = cleanupTargets(preparation);
  const failures = [];

  for (const id of [...targets.documentIds, ...targets.assetIds]) {
    try {
      await client.delete(id, { visibility: 'sync' });
    } catch (error) {
      failures.push(new Error(`Could not delete ${id} during publication cleanup.`, { cause: error }));
    }
  }

  if (failures.length) {
    throw new AggregateError(failures, 'Publication cleanup did not remove every recorded document and asset.');
  }

  return { cleaned: true, ...targets };
}
