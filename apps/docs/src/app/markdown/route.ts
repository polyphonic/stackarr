import { markdownResponse } from '~/lib/discovery';
import { absoluteUrl, githubUrl, siteDescription, siteName } from '~/lib/site';

const services = [
  'Sonarr',
  'Radarr',
  'Lidarr',
  'Prowlarr',
  'Bazarr',
  'Jellyfin',
  'Plex',
  'Pulsarr',
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
`;
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '/';

  if (path !== '/') {
    return markdownResponse(
      `# Not Found

No markdown representation is available for ${path}.
`,
      { status: 404 }
    );
  }

  return markdownResponse(landingMarkdown());
}
