import { getRecentBlogPosts } from '@stackarr/cms';
import { llms } from 'fumadocs-core/source/llms';
import { textHeaders } from '~/lib/discovery';
import { source } from '~/lib/fumadocs';
import { absoluteUrl } from '~/lib/site';

export const revalidate = 3600;

const docsIndex = llms(source).index();

export async function GET() {
  const posts = await getRecentBlogPosts(30);
  const blogSection = `

# Stackarr Homelab Field Notes

Public, source-backed articles about self-hosted infrastructure, media, automation, personal data, smart homes, and game libraries.

- Blog index: ${absoluteUrl('/blog')}
- RSS: ${absoluteUrl('/blog/feed.xml')}
- JSON Feed: ${absoluteUrl('/blog/feed.json')}
- Markdown negotiation: request a canonical blog URL with Accept: text/markdown

## Recent articles

${posts.map((post) => `- [${post.title}](${absoluteUrl(`/blog/${post.slug}`)}): ${post.excerpt}`).join('\n') || '- No articles are published yet.'}
`;

  return new Response(`${docsIndex.trim()}${blogSection}`, {
    headers: textHeaders('text/plain; charset=utf-8')
  });
}
