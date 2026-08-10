import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();
const docsRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(docsRoot, '../..');
const discoveryLinkHeader = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</docs/api>; rel="service-doc"; type="text/html"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</.well-known/oauth-protected-resource>; rel="service-meta"; type="application/json"',
  '</.well-known/mcp/server-card.json>; rel="service-meta"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="service-meta"; type="application/json"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</blog/feed.xml>; rel="alternate"; type="application/rss+xml"',
  '</auth.md>; rel="authorization"; type="text/markdown"'
].join(', ');

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  transpilePackages: ['@stackarr/ui', '@stackarr/db', '@stackarr/cms'],
  turbopack: {
    root: workspaceRoot
  },
  async rewrites() {
    return [
      {
        source: '/docs.md',
        destination: '/llms.mdx/docs'
      },
      {
        source: '/docs/:path*.md',
        destination: '/llms.mdx/docs/:path*'
      }
    ];
  },
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Link',
            value: discoveryLinkHeader
          }
        ]
      },
      {
        source: '/blog/:path*',
        headers: [
          {
            key: 'Link',
            value: discoveryLinkHeader
          }
        ]
      },
      {
        source: '/docs/:path*',
        headers: [
          {
            key: 'Link',
            value: discoveryLinkHeader
          }
        ]
      }
    ];
  },
  webpack(config) {
    config.cache = false;
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /fumadocs-mdx[\\/]dist[\\/]load-from-file/,
        message: /Parsing of .* for build dependencies failed/
      }
    ];

    return config;
  }
};

export default withMDX(config);
