import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@sanity/client';
import { cleanupPreparedArticleAssets, prepareArticlePublication } from './lib/article-publication.mjs';

const [draftPath, preparationPath] = process.argv.slice(2);
if (!(draftPath && preparationPath)) {
  throw new Error(
    'Usage: node scripts/prepare-article.mjs /absolute/path/to/article.json /absolute/path/to/preparation.json'
  );
}

const workDir = process.env.STACKARR_BLOG_WORK_DIR?.trim();
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production';
const token = process.env.STACKARR_SANITY_API_TOKEN?.trim();
if (!(workDir && projectId && token)) {
  throw new Error('STACKARR_BLOG_WORK_DIR, NEXT_PUBLIC_SANITY_PROJECT_ID, and STACKARR_SANITY_API_TOKEN are required.');
}

const resolvedWorkDir = await realpath(path.resolve(workDir));
const resolvedPreparationPath = path.resolve(preparationPath);
const resolvedPreparationParent = await realpath(path.dirname(resolvedPreparationPath));
const relativePreparationParent = path.relative(resolvedWorkDir, resolvedPreparationParent);
if (relativePreparationParent.startsWith('..') || path.isAbsolute(relativePreparationParent)) {
  throw new Error('The publication preparation file must be inside STACKARR_BLOG_WORK_DIR.');
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

let preparation;
try {
  preparation = await prepareArticlePublication({
    client,
    draftPath,
    publicClient,
    repoRoot: path.resolve(new URL('../../..', import.meta.url).pathname),
    resource: { projectId, dataset },
    workDir
  });
  await writeFile(resolvedPreparationPath, `${JSON.stringify(preparation, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
} catch (error) {
  if (preparation) {
    try {
      await cleanupPreparedArticleAssets({ client, preparation });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Preparation failed and uploaded assets could not be fully removed.'
      );
    }
  }
  throw error;
}

console.log(
  JSON.stringify({
    prepared: true,
    preparationPath: resolvedPreparationPath,
    publicId: preparation.cleanup.publicId,
    expectedUrl: preparation.verification.expectedUrl,
    uploadedAssetCount: preparation.cleanup.uploadedAssets.length
  })
);
