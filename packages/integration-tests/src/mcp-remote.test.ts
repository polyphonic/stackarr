import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('remote MCP policies are bounded, revocable, hashed, and authenticated', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-mcp-remote-'));
  const previous = {
    database: process.env.STACKARR_DATABASE_FILE,
    enabled: process.env.STACKARR_MCP_HTTP_ENABLED,
    host: process.env.STACKARR_MCP_HTTP_LISTEN_HOST,
    port: process.env.STACKARR_MCP_HTTP_PORT,
    allowedHosts: process.env.STACKARR_MCP_HTTP_ALLOWED_HOSTS
  };
  process.env.STACKARR_DATABASE_FILE = path.join(root, 'stackarr.db');
  process.env.STACKARR_MCP_HTTP_ENABLED = 'true';
  process.env.STACKARR_MCP_HTTP_LISTEN_HOST = '127.0.0.1';
  process.env.STACKARR_MCP_HTTP_PORT = '7780';
  process.env.STACKARR_MCP_HTTP_ALLOWED_HOSTS = '127.0.0.1,localhost';

  try {
    const {
      authenticateMcpConnectionToken,
      createMcpConnectionPolicyAction,
      listMcpConnectionPoliciesAction,
      updateMcpConnectionPolicyAction
    } = await import('@stackarr/core');
    assert.throws(
      () =>
        createMcpConnectionPolicyAction({
          name: 'Escalation attempt',
          profile: 'admin',
          callerProfile: 'manage'
        }),
      /admin or unrestricted/
    );

    const created = createMcpConnectionPolicyAction({
      name: 'Read-only remote test',
      profile: 'observe',
      groups: ['stack'],
      callerProfile: 'admin'
    });
    const stored = JSON.stringify(listMcpConnectionPoliciesAction());
    assert.ok(created.token.startsWith('stk_mcp_'));
    assert.ok(!stored.includes(created.token));
    assert.ok(authenticateMcpConnectionToken(created.token));

    updateMcpConnectionPolicyAction({
      id: created.policy.id,
      enabled: false,
      callerProfile: 'admin'
    });
    assert.equal(authenticateMcpConnectionToken(created.token), undefined);
  } finally {
    restore('STACKARR_DATABASE_FILE', previous.database);
    restore('STACKARR_MCP_HTTP_ENABLED', previous.enabled);
    restore('STACKARR_MCP_HTTP_LISTEN_HOST', previous.host);
    restore('STACKARR_MCP_HTTP_PORT', previous.port);
    restore('STACKARR_MCP_HTTP_ALLOWED_HOSTS', previous.allowedHosts);
    await rm(root, { recursive: true, force: true });
  }
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
