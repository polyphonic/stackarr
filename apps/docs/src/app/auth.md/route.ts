import { markdownResponse } from '~/lib/discovery';
import { absoluteUrl, githubUrl, siteName } from '~/lib/site';

export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(`# Auth.md

${siteName} agent authentication and registration metadata.

Stackarr is local-first. Public documentation is open, while a running Stackarr dashboard protects local APIs with the API key created during setup.

## Register an Agent

1. Open the Stackarr dashboard.
2. Create or copy an API key from Settings.
3. Give the agent the dashboard origin and API key only for the install it should maintain.
4. Send the key as \`X-Api-Key\` when calling \`/api/v1\` endpoints.

## Discovery

- API catalog: ${absoluteUrl('/.well-known/api-catalog')}
- OpenAPI document: ${absoluteUrl('/openapi.json')}
- MCP server card: ${absoluteUrl('/.well-known/mcp/server-card.json')}
- Agent skills: ${absoluteUrl('/.well-known/agent-skills/index.json')}
- Source repository: ${githubUrl}

## Revoke Access

Delete or rotate the API key in the Stackarr dashboard. Agents should forget revoked keys immediately and ask the user before generating a replacement.
`);
}
