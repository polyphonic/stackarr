import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { agentActivityPath, getAgentActivityRecord } from '../../core/src/actions/agentActivity';
import {
  executeAuditedInstanceMutation,
  executeInstanceOperation,
  instanceOperations
} from '../../core/src/instanceOperations';
import { InstanceActionError } from '../../core/src/instances';
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { createStackarrMcpServer } from '../../mcp/src/server';

const repo = path.resolve(import.meta.dirname, '../../..');
const cli = (args: string[], body?: object | string) => {
  const result = spawnSync(
    path.join(repo, 'packages/integration-tests/node_modules/.bin/tsx'),
    [path.join(repo, 'packages/mcp/src/index.ts'), 'instances', ...args],
    {
      input: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
      encoding: 'utf8',
      cwd: repo,
      env: process.env,
      timeout: 20000
    }
  );
  return { ...result, payload: result.status === 0 ? JSON.parse(result.stdout) : undefined };
};
async function connect(profile: 'observe' | 'manage' | 'admin', approve = false) {
  const server = createStackarrMcpServer({ profile, groups: ['services'] });
  const client = new Client(
    { name: 'draft-fixture', version: '1' },
    { capabilities: approve ? { elicitation: { form: {} } } : {} }
  );
  if (approve)
    client.setRequestHandler(ElicitRequestSchema, async () => ({
      action: 'accept' as const,
      content: { approve: true }
    }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}
const call = async (client: Client, name: string, args: object = {}) => {
  const response = await client.callTool({ name, arguments: args });
  const text = String((response.content as Array<{ text?: string }>)[0]?.text);
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: {
        code: text.includes('not_found') || text.includes('Draft instance not found') ? 'not_found' : 'unknown',
        message: text
      }
    };
  }
};

test('catalog, scopes, duplicate drafts, stable identity, approval and removal', async () => {
  const observe = await connect('observe');
  const manage = await connect('manage');
  const admin = await connect('admin');
  const approved = await connect('admin', true);
  try {
    const readNames = instanceOperations.filter((x) => x.risk === 'read').map((x) => x.mcp);
    const observeNames = (await observe.client.listTools()).tools.map((x) => x.name);
    assert.ok(readNames.every((x) => observeNames.includes(x)));
    assert.ok(!observeNames.includes('stackarr_create_instance_draft'));
    const manageNames = (await manage.client.listTools()).tools.map((x) => x.name);
    assert.ok(manageNames.includes('stackarr_create_instance_draft'));
    assert.ok(manageNames.includes('stackarr_rename_instance_draft'));
    assert.ok(!manageNames.includes('stackarr_remove_instance_draft'));
    assert.ok((await admin.client.listTools()).tools.some((x) => x.name === 'stackarr_remove_instance_draft'));
    const catalog = await call(observe.client, 'stackarr_list_app_definitions');
    const cliCatalog = cli(['catalog']);
    assert.equal(cliCatalog.status, 0, cliCatalog.stderr);
    assert.deepEqual(catalog, cliCatalog.payload);
    assert.equal(catalog.items.length, 24);
    const input = { definitionId: 'sonarr', displayName: 'Duplicate', ownership: 'managed' };
    const one = await call(manage.client, 'stackarr_create_instance_draft', input);
    const two = await call(manage.client, 'stackarr_create_instance_draft', input);
    assert.equal(one.audit.status, 'recorded');
    for (const [tool, args] of [
      ['stackarr_list_app_definitions', { configuration: {} }],
      ['stackarr_list_instance_drafts', { secretReferences: {} }],
      ['stackarr_create_instance_draft', { ...input, configuration: {} }],
      ['stackarr_rename_instance_draft', { id: one.id, displayName: 'Wrong', secretReferences: {} }],
      ['stackarr_remove_instance_draft', { id: one.id, configuration: {} }]
    ] as const) {
      const response = await manage.client.callTool({ name: tool, arguments: args });
      assert.equal(response.isError, true, `${tool} silently discarded unknown input`);
    }
    assert.notEqual(one.id, two.id);
    const list = await call(observe.client, 'stackarr_list_instance_drafts', { limit: 100 });
    assert.equal(list.items.length, 2);
    const renamed = await call(manage.client, 'stackarr_rename_instance_draft', { id: one.id, displayName: 'Revised' });
    assert.equal(renamed.id, one.id);
    assert.equal(renamed.displayName, 'Revised');
    assert.equal(two.displayName, 'Duplicate');
    const conflicting = cli(['rename', two.id], { id: one.id, displayName: 'Wrong' });
    assert.notEqual(conflicting.status, 0);
    assert.equal(JSON.parse(conflicting.stderr).error.code, 'invalid_input');
    assert.equal(
      (await call(observe.client, 'stackarr_list_instance_drafts')).items.find((x: { id: string }) => x.id === one.id)
        .displayName,
      'Revised'
    );
    assert.equal(
      (await call(observe.client, 'stackarr_list_instance_drafts')).items.find((x: { id: string }) => x.id === two.id)
        .displayName,
      'Duplicate'
    );
    const missing = await call(manage.client, 'stackarr_rename_instance_draft', {
      id: '00000000-0000-4000-8000-000000000000',
      displayName: 'None'
    });
    assert.equal(missing.code ?? missing.error?.code, 'not_found');
    const denied = await call(admin.client, 'stackarr_remove_instance_draft', { id: one.id });
    assert.equal(denied.approvalRequired, true);
    assert.equal((await call(observe.client, 'stackarr_list_instance_drafts')).items.length, 2);
    const removed = await call(approved.client, 'stackarr_remove_instance_draft', { id: one.id });
    assert.equal(removed.id, one.id);
    assert.deepEqual(
      (await call(observe.client, 'stackarr_list_instance_drafts')).items.map((x: { id: string }) => x.id),
      [two.id]
    );
    const cliCreated = cli(['create'], input);
    assert.equal(cliCreated.status, 0, cliCreated.stderr);
    assert.equal(cliCreated.payload.state, 'draft');
    const cliRenamed = cli(['rename', cliCreated.payload.id], { displayName: 'CLI' });
    assert.equal(cliRenamed.status, 0, cliRenamed.stderr);
    assert.equal(cliRenamed.payload.id, cliCreated.payload.id);
    assert.notEqual(cli(['remove', cliCreated.payload.id]).status, 0);
    assert.equal(cli(['remove', cliCreated.payload.id, '--yes']).status, 0);
    assert.notEqual(cli(['create'], { ...input, configuration: { token: 'private' } }).status, 0);
    assert.notEqual(cli(['rename', two.id], { displayName: 'No', secretReferences: {} }).status, 0);
    assert.notEqual(cli(['create'], '{'.repeat(16385)).status, 0);
    for (const failed of [
      cli(['create'], '{'),
      cli(['create'], '{'.repeat(16385)),
      cli(['rename']),
      cli(['remove', 'bad', '--yes'])
    ]) {
      assert.notEqual(failed.status, 0);
      assert.ok(['invalid_input', 'not_found'].includes(JSON.parse(failed.stderr).error.code));
      assert.doesNotMatch(failed.stderr, /\n\s+at |postgres:\/\/|SQL SELECT/);
    }
    assert.notEqual(cli(['list', '--limit', '101']).status, 0);
    assert.notEqual(cli(['create'], { ...input, displayName: 'bad\u0000control' }).status, 0);
  } finally {
    await Promise.all([observe.close(), manage.close(), admin.close(), approved.close()]);
  }
});

test('audit update error and silent no-op never convert committed mutations into failures', async () => {
  const db = new DatabaseSync(process.env.STACKARR_DATABASE_FILE!);
  try {
    for (const mode of ['error', 'silent'] as const) {
      const action = mode === 'error' ? "raise(abort, 'private SQL fault')" : 'raise(ignore)';
      db.exec(
        `create trigger audit_finish_fault before update on agent_activity when new.status = 'success' begin select ${action}; end;`
      );
      const before = executeInstanceOperation('list').items.length;
      const created = await executeAuditedInstanceMutation('create', {
        definitionId: 'sonarr',
        displayName: 'Audit',
        ownership: 'managed'
      });
      assert.equal(created.audit.status, 'degraded');
      assert.equal(executeInstanceOperation('list').items.length, before + 1);
      const renamed = await executeAuditedInstanceMutation('rename', { id: created.id, displayName: 'After audit' });
      assert.equal(renamed.audit.status, 'degraded');
      assert.equal(executeInstanceOperation('list').items.find((x) => x.id === created.id)?.displayName, 'After audit');
      const removed = await executeAuditedInstanceMutation('remove', { id: created.id });
      assert.equal(removed.audit.status, 'degraded');
      assert.equal(executeInstanceOperation('list').items.length, before);
      for (const result of [created, renamed, removed]) {
        const audit = await getAgentActivityRecord(result.audit.id);
        assert.equal(audit?.status, 'started');
        assert.deepEqual(audit?.inputSummary, {
          action: result === created ? 'create' : result === renamed ? 'rename' : 'remove',
          targetId: result === created ? null : created.id,
          outcome: 'started'
        });
        assert.doesNotMatch(JSON.stringify(result), /private SQL fault/);
      }
      await assert.rejects(
        executeAuditedInstanceMutation('rename', { id: 'not-a-uuid', displayName: 'Wrong' }),
        (error: unknown) => error instanceof Error && error.message === 'Invalid instance ID.'
      );
      db.exec('drop trigger audit_finish_fault');
    }
    const before = executeInstanceOperation('list').items.length;
    db.exec('create trigger audit_start_fault before insert on agent_activity begin select raise(ignore); end;');
    await assert.rejects(
      executeAuditedInstanceMutation('create', {
        definitionId: 'sonarr',
        displayName: 'Blocked',
        ownership: 'managed'
      }),
      (error: unknown) => error instanceof Error && error.message === 'Instance store unavailable.'
    );
    assert.equal(executeInstanceOperation('list').items.length, before);
    db.exec('drop trigger audit_start_fault');
  } finally {
    db.close();
  }
});

test('MCP draft reads sanitize audit completion failures', async () => {
  const session = await connect('observe');
  const db = new DatabaseSync(process.env.STACKARR_DATABASE_FILE!);
  try {
    db.exec(
      "create trigger read_audit_fault before update on agent_activity begin select raise(abort, 'fixture audit failure'); end;"
    );
    writeFileSync(agentActivityPath, 'fixture-private-audit-value');
    for (const name of ['stackarr_list_app_definitions', 'stackarr_list_instance_drafts']) {
      const response = await session.client.callTool({ name, arguments: {} });
      const content = String((response.content as Array<{ text?: string }>)[0]?.text);
      assert.equal(response.isError, true);
      assert.doesNotMatch(content, /fixture-private|SyntaxError|JSON.parse|agent-activity/);
      assert.deepEqual(JSON.parse(content), {
        error: { code: 'store_unavailable', message: 'Instance store unavailable.' }
      });
    }
  } finally {
    db.exec('drop trigger read_audit_fault');
    db.close();
    rmSync(agentActivityPath, { force: true });
    await session.close();
  }
});

test('offline PostgreSQL failure is sanitized at CLI and MCP boundaries', async () => {
  const bin = path.join(process.env.HOME!, 'bin');
  mkdirSync(bin, { recursive: true });
  const stub = path.join(bin, 'psql');
  writeFileSync(
    stub,
    '#!/bin/sh\necho "psql: postgres://user:secret@offline.invalid/main SQL SELECT private" >&2\nexit 1\n'
  );
  chmodSync(stub, 0o755);
  const oldPath = process.env.PATH;
  const client = await connect('observe');
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.STACKARR_DATABASE_MODE = 'postgres';
  process.env.STACKARR_DATABASE_URL = 'postgres://user:secret@offline.invalid/main';
  try {
    const result = await call(client.client, 'stackarr_list_instance_drafts');
    assert.equal(result.error.code, 'store_unavailable');
    assert.doesNotMatch(JSON.stringify(result), /secret|SELECT private|offline\.invalid/);
    const child = cli(['list']);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Instance store unavailable/);
    assert.doesNotMatch(child.stderr, /secret|SELECT private|offline\.invalid/);
  } finally {
    await client.close();
    process.env.PATH = oldPath;
    process.env.STACKARR_DATABASE_MODE = 'sqlite';
    delete process.env.STACKARR_DATABASE_URL;
  }
});

test('connections through SDK and source CLI enforce scope, approval, audit and removal conflict', async () => {
  const observe = await connect('observe');
  const manage = await connect('manage');
  const admin = await connect('admin');
  const approved = await connect('admin', true);
  try {
    const readNames = (await observe.client.listTools()).tools.map((x) => x.name);
    assert.ok(readNames.includes('stackarr_list_instance_connections'));
    assert.ok(!readNames.includes('stackarr_connect_instance_drafts'));
    assert.ok((await manage.client.listTools()).tools.some((x) => x.name === 'stackarr_connect_instance_drafts'));
    assert.ok(!(await manage.client.listTools()).tools.some((x) => x.name === 'stackarr_disconnect_instance_drafts'));
    assert.ok((await admin.client.listTools()).tools.some((x) => x.name === 'stackarr_disconnect_instance_drafts'));
    const source = await call(manage.client, 'stackarr_create_instance_draft', {
      definitionId: 'sonarr',
      displayName: 'Source',
      ownership: 'managed'
    });
    const target = await call(manage.client, 'stackarr_create_instance_draft', {
      definitionId: 'qbittorrent',
      displayName: 'Target',
      ownership: 'external'
    });
    const edge = { sourceId: source.id, targetId: target.id, kind: 'download-client' };
    for (const [name, args] of [
      ['stackarr_list_instance_connections', { instanceId: source.id, limit: 1000 }],
      ['stackarr_list_instance_connections', { instanceId: source.id, cursor: 'bad' }],
      ['stackarr_connect_instance_drafts', { ...edge, configuration: { password: 'private' } }],
      ['stackarr_disconnect_instance_drafts', { ...edge, kind: 'other' }]
    ] as const) {
      const response = await approved.client.callTool({ name, arguments: args });
      assert.equal(response.isError, true, name);
    }
    assert.equal(
      (await call(observe.client, 'stackarr_list_instance_connections', { instanceId: source.id })).items.length,
      0
    );
    const linked = await call(manage.client, 'stackarr_connect_instance_drafts', edge);
    assert.equal(linked.audit.status, 'recorded');
    assert.deepEqual((await getAgentActivityRecord(linked.audit.id))?.inputSummary, {
      action: 'connect',
      sourceId: source.id,
      targetId: target.id,
      outcome: 'started'
    });
    assert.equal(
      (await call(observe.client, 'stackarr_list_instance_connections', { instanceId: target.id, limit: 1 })).items[0]
        .sourceId,
      source.id
    );
    assert.equal(
      (await call(approved.client, 'stackarr_remove_instance_draft', { id: target.id })).error.code,
      'conflict'
    );
    assert.equal((await call(admin.client, 'stackarr_disconnect_instance_drafts', edge)).approvalRequired, true);
    assert.notEqual(cli(['disconnect', source.id, target.id]).status, 0);
    const disconnected = cli(['disconnect', source.id, target.id, '--yes']);
    assert.equal(disconnected.status, 0, disconnected.stderr);
    assert.equal(disconnected.payload.audit.status, 'recorded');
    assert.equal(
      (await call(observe.client, 'stackarr_list_instance_connections', { instanceId: source.id })).items.length,
      0
    );
    const reconnect = cli(['connect', source.id, target.id, '--yes']);
    assert.equal(reconnect.status, 0, reconnect.stderr);
    assert.equal(cli(['connections', source.id]).payload.items.length, 1);
    const conflict = cli(['remove', target.id, '--yes']);
    assert.equal(JSON.parse(conflict.stderr).error.code, 'conflict');
    assert.doesNotMatch(conflict.stderr, /private|\n\s+at /);
    const unlinked = await call(approved.client, 'stackarr_disconnect_instance_drafts', edge);
    assert.equal(unlinked.audit.status, 'recorded');
    assert.equal((await call(approved.client, 'stackarr_remove_instance_draft', { id: target.id })).id, target.id);
  } finally {
    await Promise.all([observe.close(), manage.close(), admin.close(), approved.close()]);
  }
});

test('connection audit start must persist and failed finish reports committed edge as degraded', async () => {
  const db = new DatabaseSync(process.env.STACKARR_DATABASE_FILE!);
  const source = executeInstanceOperation('create', {
    definitionId: 'lidarr',
    displayName: 'Music audit',
    ownership: 'managed'
  });
  const target = executeInstanceOperation('create', {
    definitionId: 'qbittorrent',
    displayName: 'Download audit',
    ownership: 'native'
  });
  const edge = { sourceId: source.id, targetId: target.id, kind: 'download-client' };
  try {
    db.exec('create trigger connection_audit_start before insert on agent_activity begin select raise(ignore); end;');
    await assert.rejects(
      executeAuditedInstanceMutation('connect', edge),
      (error: unknown) => error instanceof InstanceActionError && error.code === 'store_unavailable'
    );
    assert.equal(executeInstanceOperation('connections', { instanceId: source.id }).items.length, 0);
    db.exec('drop trigger connection_audit_start');
    db.exec(
      "create trigger connection_audit_finish before update on agent_activity when new.status = 'success' begin select raise(ignore); end;"
    );
    const linked = await executeAuditedInstanceMutation('connect', edge);
    assert.equal(linked.audit.status, 'degraded');
    assert.equal(executeInstanceOperation('connections', { instanceId: source.id }).items.length, 1);
    const unlinked = await executeAuditedInstanceMutation('disconnect', edge);
    assert.equal(unlinked.audit.status, 'degraded');
    assert.equal(executeInstanceOperation('connections', { instanceId: source.id }).items.length, 0);
    db.exec('drop trigger connection_audit_finish');
  } finally {
    db.close();
  }
});
