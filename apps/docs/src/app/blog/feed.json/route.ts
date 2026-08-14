import { getRecentBlogPosts } from '@stackarr/cms';
import { absoluteUrl, siteDescription } from '~/lib/site';

export const revalidate = 60;

export async function GET() {
  const posts = await getRecentBlogPosts(50);
  return Response.json(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Stackarr Homelab Field Notes',
      home_page_url: absoluteUrl('/blog'),
      feed_url: absoluteUrl('/blog/feed.json'),
      description: siteDescription,
      icon: absoluteUrl('/icon-512.png'),
      items: posts.map((post) => ({
        id: absoluteUrl(`/blog/${post.slug}`),
        url: absoluteUrl(`/blog/${post.slug}`),
        title: post.title,
        summary: post.excerpt,
        content_text: post.excerpt,
        date_published: post.publishedAt,
        date_modified: post.updatedAt || post._updatedAt,
        tags: post.tags,
        image: post.coverImage?.url
      }))
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60, must-revalidate',
        'Content-Type': 'application/feed+json; charset=utf-8'
      }
    }
  );
}
