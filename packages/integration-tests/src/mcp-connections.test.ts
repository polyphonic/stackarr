import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMcpConnectionKit, getMcpConnectionKits } from '@stackarr/core';

test('Codex connection kit generates a Docker stdio install command', () => {
  const kit = getMcpConnectionKit({
    client: 'codex',
    profile: 'manage',
    groups: ['stack', 'arr'],
    containerName: 'stackarr-app'
  });

  assert.equal(kit.transport, 'docker-stdio');
  assert.match(kit.command ?? '', /^codex mcp add stackarr -- docker exec -i/);
  assert.match(kit.command ?? '', /STACKARR_MCP_PROFILE=manage/);
  assert.match(kit.command ?? '', /STACKARR_MCP_CLIENT=codex/);
  assert.match(kit.command ?? '', /STACKARR_MCP_GROUPS=stack,arr/);
  assert.match(kit.command ?? '', /stackarr-app \/app\/bin\/stackarr mcp serve$/);
});

test('LM Studio connection kit uses mcp.json notation and explains fail-closed approvals', () => {
  const kit = getMcpConnectionKit({ client: 'lmstudio', profile: 'admin' });
  const config = kit.config as {
    mcpServers: { stackarr: { command: string; args: string[] } };
  };

  assert.equal(config.mcpServers.stackarr.command, 'docker');
  assert.deepEqual(config.mcpServers.stackarr.args.slice(0, 7), [
    'exec',
    '-i',
    '-e',
    'STACKARR_MCP_PROFILE=admin',
    '-e',
    'STACKARR_MCP_CLIENT=lmstudio',
    'app'
  ]);
  assert.ok(kit.warnings.some((warning) => warning.includes('fail closed')));
  assert.equal(kit.documentationUrl, 'https://lmstudio.ai/docs/app/mcp');
});

test('ChatGPT connection kit keeps Stackarr private through an outbound tunnel', () => {
  const kit = getMcpConnectionKit({
    client: 'chatgpt',
    profile: 'unrestricted',
    tunnelId: 'tunnel_example'
  });

  assert.equal(kit.transport, 'openai-secure-tunnel');
  assert.match(kit.command ?? '', /tunnel-client init/);
  assert.match(kit.command ?? '', /tunnel_example/);
  assert.match(kit.command ?? '', /docker exec -i/);
  assert.doesNotMatch(kit.command ?? '', /https?:\/\/.*\/mcp/);
  assert.ok(kit.warnings.some((warning) => warning.includes('complete control')));
  assert.ok(kit.warnings.some((warning) => warning.includes('Never paste')));
});

test('connection kits cover every supported chat surface without embedding secrets', () => {
  const kits = getMcpConnectionKits({ profile: 'observe' });

  assert.deepEqual(
    kits.map((kit) => kit.client),
    ['codex', 'claude', 'lmstudio', 'chatgpt', 'hermes', 'openclaw', 'generic']
  );
  assert.ok(kits.every((kit) => !JSON.stringify(kit).includes('sk-')));
});
