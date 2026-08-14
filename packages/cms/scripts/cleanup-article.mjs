import path from 'node:path';
import process from 'node:process';
import { createClient } from '@sanity/client';
import { cleanupArticlePublication, readPublicationPreparation } from './lib/article-publication.mjs';

const preparationPath = process.argv[2];
if (!preparationPath) {
  throw new Error('Usage: node scripts/cleanup-article.mjs /absolute/path/to/preparation.json');
}

const workDir = process.env.STACKARR_BLOG_WORK_DIR?.trim();
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production';
const token = process.env.STACKARR_SANITY_API_TOKEN?.trim();
if (!(workDir && projectId && token)) {
  throw new Error('STACKARR_BLOG_WORK_DIR, NEXT_PUBLIC_SANITY_PROJECT_ID, and STACKARR_SANITY_API_TOKEN are required.');
}

const preparation = await readPublicationPreparation({ preparationPath, workDir });
if (
  preparation.createDocuments?.resource?.projectId !== projectId ||
  preparation.createDocuments?.resource?.dataset !== dataset
) {
  throw new Error('The publication preparation targets a different Sanity project or dataset.');
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: '2026-08-10',
  useCdn: false,
  perspective: 'raw'
});
const result = await cleanupArticlePublication({ client, preparation });
console.log(JSON.stringify({ ...result, preparationPath: path.resolve(preparationPath) }));
