import type { MetadataRoute } from 'next';
import { source } from '~/lib/fumadocs';
import { absoluteUrl } from '~/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const docsEntries = source.getPages().map((page) => ({
    url: absoluteUrl(page.url),
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: page.url === '/docs' ? 0.9 : 0.65
  }));

  return [
    {
      url: absoluteUrl('/'),
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    },
    ...docsEntries
  ];
}
