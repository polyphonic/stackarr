import { readFile } from 'node:fs/promises';
import { createClient } from '@sanity/client';

const config = JSON.parse(await readFile(new URL('../editorial.config.json', import.meta.url), 'utf8'));
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

const transaction = client.transaction().createIfNotExists({
  _id: 'author-stackarr-editorial',
  _type: 'author',
  name: 'Stackarr Editorial',
  role: 'Homelab research and product team',
  bio: 'Practical, source-backed guides for safer and more reliable self-hosted systems.',
  url: 'https://stackarr.app/blog'
});

config.categories.forEach((category, order) => {
  transaction.createIfNotExists({
    _id: `category-${category.slug}`,
    _type: 'category',
    title: category.title,
    slug: { _type: 'slug', current: category.slug },
    description: category.description,
    order
  });
});

const result = await transaction.commit({ visibility: 'sync' });
console.log(`Seeded Stackarr author and ${config.categories.length} categories at ${result.transactionId}.`);
