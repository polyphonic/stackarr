import { getBlogCategories, getBlogSitemapEntries } from '@stackarr/cms';
import type { MetadataRoute } from 'next';
import { source } from '~/lib/fumadocs';
import { absoluteUrl } from '~/lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, categories] = await Promise.all([getBlogSitemapEntries(), getBlogCategories()]);
  const docsEntries = source.getPages().map((page) => ({
    url: absoluteUrl(page.url),
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: page.url === '/docs' ? 0.9 : 0.65
  }));
  const postEntries = posts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.updatedAt || post._updatedAt || post.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.75
  }));
  const categoryEntries = categories.map((category) => ({
    url: absoluteUrl(`/blog/category/${category.slug}`),
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.65
  }));
  const latestPost = posts[0];

  return [
    {
      url: absoluteUrl('/'),
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    },
    {
      url: absoluteUrl('/blog'),
      lastModified: latestPost
        ? new Date(latestPost.updatedAt || latestPost._updatedAt || latestPost.publishedAt)
        : new Date(),
      changeFrequency: 'daily',
      priority: 0.9
    },
    ...categoryEntries,
    ...postEntries,
    ...docsEntries
  ];
}
