import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

test('dangerous MCP calls use elicitation and decline without executing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-mcp-protocol-test-'));
  const previousDatabase = process.env.STACKARR_DATABASE_FILE;
  const previousProfile = process.env.STACKARR_MCP_PROFILE;
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');
  process.env.STACKARR_MCP_PROFILE = 'admin';

  const { createStackarrMcpServer } = await import('../../mcp/src/server');
  const server = createStackarrMcpServer();
  const client = new Client(
    { name: 'stackarr-integration-test', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } }
  );
  let elicitationMessage = '';
  let elicitationMeta: Record<string, unknown> | undefined;
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    elicitationMessage = request.params.message;
    elicitationMeta = request.params._meta;
    return { action: 'decline' as const };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    const updateConfig = listed.tools.find((tool) => tool.name === 'stackarr_update_stack_config');
    const addCloudflareEmail = listed.tools.find((tool) => tool.name === 'stackarr_add_cloudflare_access_email');
    const cloudflareEmailSchema = addCloudflareEmail?.inputSchema.properties?.email as { format?: string } | undefined;

    assert.ok(updateConfig);
    assert.ok(addCloudflareEmail);
    assert.equal(addCloudflareEmail.annotations?.destructiveHint, true);
    assert.equal(cloudflareEmailSchema?.format, 'email');
    assert.equal(updateConfig.annotations?.destructiveHint, true);
    assert.equal(updateConfig.annotations?.readOnlyHint, false);
    assert.equal(updateConfig.inputSchema.properties?.confirmDangerous, undefined);

    const result = await client.callTool({
      name: 'stackarr_update_stack_config',
      arguments: { values: { RADARR_URL: 'http://untrusted.invalid' } }
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    const payload = JSON.parse(String(content[0]?.type === 'text' ? content[0].text : '{}'));

    assert.equal(payload.accepted, false);
    assert.equal(payload.decision, 'decline');
    assert.match(elicitationMessage, /stackarr_update_stack_config/);
    assert.match(elicitationMessage, /http:\/\/untrusted\.invalid/);
    assert.equal(elicitationMeta?.codex_approval_kind, 'mcp_tool_call');
  } finally {
    await client.close();
    await server.close();
    if (previousDatabase === undefined) delete process.env.STACKARR_DATABASE_FILE;
    else process.env.STACKARR_DATABASE_FILE = previousDatabase;
    if (previousProfile === undefined) delete process.env.STACKARR_MCP_PROFILE;
    else process.env.STACKARR_MCP_PROFILE = previousProfile;
    await rm(root, { recursive: true, force: true });
  }
});
