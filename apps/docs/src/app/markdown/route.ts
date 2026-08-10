import { getBlogPostBySlug, getRecentBlogPosts } from '@stackarr/cms';
import { blogIndexToMarkdown, blogPostToMarkdown } from '@stackarr/cms/markdown';
import { markdownResponse } from '~/lib/discovery';
import { absoluteUrl, githubUrl, siteDescription, siteName } from '~/lib/site';

const BLOG_POST_PATH_RE = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const services = [
  'Sonarr',
  'Radarr',
  'Lidarr',
  'Prowlarr',
  'Bazarr',
  'Jellyfin',
  'Plex',
  'Pulsarr',
  'Immich',
  'RomM',
  'BookOrbit',
  'Transmission',
  'qBittorrent',
  'Postgres',
  'Cloudflare'
];

function landingMarkdown() {
  return `# ${siteName}

${siteDescription}

One dashboard to set up media requests, downloads, libraries, backups, books, and remote access for your home server.

## Managed Services

${services.map((service) => `- ${service}`).join('\n')}

## Start

- Blog: ${absoluteUrl('/blog')}
- Documentation: ${absoluteUrl('/docs')}
- Installation: ${absoluteUrl('/docs/installation')}
- API documentation: ${absoluteUrl('/docs/api')}
- MCP setup: ${absoluteUrl('/docs/agent/mcp')}
- GitHub: ${githubUrl}

## Discovery

- API catalog: ${absoluteUrl('/.well-known/api-catalog')}
- OpenAPI: ${absoluteUrl('/openapi.json')}
- MCP server card: ${absoluteUrl('/.well-known/mcp/server-card.json')}
- Agent skills: ${absoluteUrl('/.well-known/agent-skills/index.json')}
- Blog RSS: ${absoluteUrl('/blog/feed.xml')}
`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname === '/markdown' ? url.searchParams.get('source') || '/' : url.pathname;

  if (path === '/') return markdownResponse(landingMarkdown());
  if (path === '/blog') return markdownResponse(blogIndexToMarkdown(await getRecentBlogPosts(100)));

  const blogMatch = path.match(BLOG_POST_PATH_RE);
  if (blogMatch) {
    const post = await getBlogPostBySlug(blogMatch[1]);
    return post
      ? markdownResponse(blogPostToMarkdown(post))
      : markdownResponse(`# Not Found\n\nNo published article exists at ${path}.\n`, { status: 404 });
  }

  return markdownResponse(`# Not Found\n\nNo markdown representation is available for ${path}.\n`, { status: 404 });
}
