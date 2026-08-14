import { getRecentBlogPosts } from '@stackarr/cms';
import { absoluteUrl, siteDescription, siteName } from '~/lib/site';

export const revalidate = 3600;

function xml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export async function GET() {
  const posts = await getRecentBlogPosts(50);
  const items = posts
    .map(
      (post) => `<item>
  <title>${xml(post.title)}</title>
  <link>${xml(absoluteUrl(`/blog/${post.slug}`))}</link>
  <guid isPermaLink="true">${xml(absoluteUrl(`/blog/${post.slug}`))}</guid>
  <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
  <description>${xml(post.excerpt)}</description>
  ${post.category ? `<category>${xml(post.category.title)}</category>` : ''}
</item>`
    )
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${xml(siteName)} Homelab Field Notes</title>
  <link>${xml(absoluteUrl('/blog'))}</link>
  <description>${xml(siteDescription)}</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  ${items}
</channel>
</rss>\n`;

  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
      'Content-Type': 'application/rss+xml; charset=utf-8'
    }
  });
}
