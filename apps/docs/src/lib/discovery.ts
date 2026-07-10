import { createHash } from 'node:crypto';
import { absoluteUrl, siteDescription, siteName, siteVersion } from './site';

export const linkHeaderValue = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</docs/api>; rel="service-doc"; type="text/html"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</.well-known/oauth-protected-resource>; rel="service-meta"; type="application/json"',
  '</.well-known/mcp/server-card.json>; rel="service-meta"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="service-meta"; type="application/json"',
  '</auth.md>; rel="authorization"; type="text/markdown"'
].join(', ');

export const discoveryHeaders = {
  Link: linkHeaderValue
};

export function textHeaders(contentType: string, extra?: Record<string, string>) {
  return {
    ...discoveryHeaders,
    'Cache-Control': 'public, max-age=0, s-maxage=3600',
    'Content-Type': contentType,
    ...extra
  };
}

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    ...init,
    headers: {
      ...textHeaders('application/json; charset=utf-8'),
      ...init?.headers
    }
  });
}

export function markdownResponse(markdown: string, init?: ResponseInit) {
  const tokens = Math.max(1, Math.ceil(markdown.trim().split(/\s+/).length * 1.3));

  return new Response(markdown.endsWith('\n') ? markdown : `${markdown}\n`, {
    ...init,
    headers: {
      ...textHeaders('text/markdown; charset=utf-8', {
        'x-markdown-tokens': String(tokens)
      }),
      ...init?.headers
    }
  });
}

export function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Stackarr API',
    version: siteVersion,
    description:
      'Local Stackarr API used by the dashboard and trusted automation agents. Deployments authenticate with the API key created during setup.'
  },
  servers: [
    {
      url: absoluteUrl('/api/v1'),
      description:
        'Public documentation origin. Replace with your local Stackarr dashboard origin when calling a running stack.'
    }
  ],
  security: [{ apiKey: [] }],
  paths: {
    '/health': {
      get: {
        summary: 'Read stack health',
        responses: {
          '200': {
            description: 'Health summary'
          }
        }
      }
    },
    '/commands': {
      post: {
        summary: 'Queue a Stackarr command',
        responses: {
          '202': {
            description: 'Command accepted'
          }
        }
      }
    },
    '/tasks': {
      get: {
        summary: 'List queued and completed tasks',
        responses: {
          '200': {
            description: 'Task list'
          }
        }
      }
    },
    '/agent/tools': {
      get: {
        summary: 'List the active agent control plane and available actions',
        responses: {
          '200': {
            description: 'Authority, enabled apps, and filtered action catalog'
          }
        }
      }
    },
    '/agent/connections': {
      get: {
        summary: 'Generate MCP client connection kits',
        responses: {
          '200': {
            description: 'Copy-ready Docker stdio or private tunnel connection instructions'
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key'
      }
    }
  }
};

export const agentSkillDocuments = {
  'stackarr-setup': {
    name: 'stackarr-setup',
    type: 'setup',
    description: 'Guide an installer through Stackarr setup using defaults or step-by-step choices.',
    content: `# Stackarr Setup Skill

Use this skill when a user wants to install or configure Stackarr.

1. Ask whether they want the standard setup or advanced setup.
2. Collect media server, download client, storage path, backup path, and remote access choices.
3. Use Stackarr commands or the local dashboard API to apply the setup.
4. Verify the dashboard, managed services, backups, and agent access before finishing.
`
  },
  'stackarr-maintenance': {
    name: 'stackarr-maintenance',
    type: 'operations',
    description: 'Run routine Stackarr maintenance for backups, updates, health checks, and service access.',
    content: `# Stackarr Maintenance Skill

Use this skill when a user asks an agent to maintain an existing Stackarr install.

1. Check dashboard health and recent tasks.
2. Confirm backups are scheduled and the latest archive completed.
3. Review service status before running updates or repairs.
4. Prefer Stackarr actions over direct service edits so configuration stays consistent.
`
  },
  'stackarr-api': {
    name: 'stackarr-api',
    type: 'api',
    description: 'Discover Stackarr API documentation, authentication, and command endpoints.',
    content: `# Stackarr API Skill

Use this skill when an agent needs to call Stackarr APIs.

1. Read the API catalog at /.well-known/api-catalog.
2. Read /auth.md for authentication expectations.
3. Use the OpenAPI document at /openapi.json for command, task, and health endpoints.
4. Send the user's Stackarr API key as X-Api-Key when calling a running local dashboard.
`
  }
} as const;

export function agentSkillIndex() {
  return {
    $schema: 'https://agentskills.io/schemas/agent-skills-index-v0.2.json',
    name: siteName,
    description: siteDescription,
    skills: Object.values(agentSkillDocuments).map((skill) => ({
      name: skill.name,
      type: skill.type,
      description: skill.description,
      url: absoluteUrl(`/.well-known/agent-skills/${skill.name}/SKILL.md`),
      sha256: sha256(skill.content)
    }))
  };
}

export function mcpServerCard() {
  return {
    schemaVersion: '2025-06-18',
    serverInfo: {
      name: '@stackarr/mcp',
      title: 'Stackarr MCP Server',
      version: siteVersion
    },
    description: 'Chat control plane for trusted agents that configure and maintain a Stackarr homelab.',
    documentationUrl: absoluteUrl('/docs/agent/mcp'),
    transports: [
      {
        type: 'stdio',
        command: 'docker',
        args: ['exec', '-i', '-e', 'STACKARR_MCP_PROFILE=manage', 'app', '/app/bin/stackarr', 'mcp', 'serve']
      },
      {
        type: 'streamable-http',
        url: 'https://YOUR_PRIVATE_STACKARR_HOST/mcp',
        authorization: 'Bearer token from a named Stackarr connection policy',
        disabledByDefault: true
      }
    ],
    connectionGenerator: 'docker exec app /app/bin/stackarr mcp config <client> --profile <profile>',
    capabilities: {
      tools: true,
      resources: false,
      prompts: false
    }
  };
}

export function apiCatalog() {
  return {
    linkset: [
      {
        anchor: absoluteUrl('/api/v1'),
        'service-desc': [
          {
            href: absoluteUrl('/openapi.json'),
            type: 'application/vnd.oai.openapi+json'
          }
        ],
        'service-doc': [
          {
            href: absoluteUrl('/docs/api'),
            type: 'text/html'
          }
        ],
        'service-meta': [
          {
            href: absoluteUrl('/.well-known/oauth-protected-resource'),
            type: 'application/json'
          },
          {
            href: absoluteUrl('/.well-known/mcp/server-card.json'),
            type: 'application/json'
          },
          {
            href: absoluteUrl('/.well-known/agent-skills/index.json'),
            type: 'application/json'
          }
        ],
        status: [
          {
            href: absoluteUrl('/.well-known/status'),
            type: 'application/json'
          }
        ]
      }
    ]
  };
}

export function protectedResourceMetadata() {
  return {
    resource: absoluteUrl('/api/v1'),
    authorization_servers: [absoluteUrl('/.well-known/oauth-authorization-server')],
    bearer_methods_supported: ['header'],
    scopes_supported: ['stackarr:read', 'stackarr:write'],
    resource_documentation: absoluteUrl('/docs/api/authentication')
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: absoluteUrl('/'),
    service_documentation: absoluteUrl('/auth.md'),
    scopes_supported: ['stackarr:read', 'stackarr:write'],
    protected_resources: [absoluteUrl('/api/v1')],
    agent_auth: {
      skill: absoluteUrl('/auth.md'),
      register_uri: absoluteUrl('/auth.md'),
      identity_types_supported: ['user-approved-agent'],
      supported_identity_types: ['user-approved-agent'],
      credential_types: ['api_key'],
      claim_uri: absoluteUrl('/auth.md#register-an-agent'),
      claims_supported: ['name', 'purpose', 'contact'],
      revocation_endpoint: absoluteUrl('/auth.md#revoke-access'),
      revocation_uri: absoluteUrl('/auth.md#revoke-access')
    }
  };
}
