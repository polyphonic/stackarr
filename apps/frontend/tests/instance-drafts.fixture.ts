import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { NextRequest } from 'next/server';

const catalog = JSON.parse(readFileSync('packages/core/src/instance-catalog.json', 'utf8')) as {
  sourceCounts: { registry: number; compose: number };
  entries: Array<{ sourceId: string; kind: string; definitionId: string | null }>;
};

const root = process.env.STACKARR_TEST_ROOT!;
const { writeEnvConfig } = await import('@stackarr/core/env');
const { createDraftInstanceAction, listDraftInstancesAction, renameDraftInstanceAction, removeDraftInstanceAction } =
  await import('@stackarr/core/instances');
const { GET, POST } = await import('../src/app/api/v1/instances/route');
const { PATCH, DELETE } = await import('../src/app/api/v1/instances/[id]/route');
const { GET: catalogGET } = await import('../src/app/api/v1/app-definitions/route');
const api = (url: string, method = 'GET', body?: unknown, key = 'test-key') =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'x-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test('draft actions and actual route handlers persist, paginate, and reject unsafe inputs', async () => {
  try {
    writeEnvConfig({ STACKARR_API_KEY: 'test-key' });
    assert.deepEqual(listDraftInstancesAction().items, []);
    assert.equal((await GET(api('/api/v1/instances', 'GET', undefined, 'wrong'))).status, 401);
    const definitions = await catalogGET(api('/api/v1/app-definitions'));
    assert.equal(definitions.status, 200);
    assert.ok((await definitions.json()).items.some((item: { id: string }) => item.id === 'sonarr'));
    const created = await POST(
      api('/api/v1/instances', 'POST', { definitionId: 'sonarr', displayName: 'TV', ownership: 'managed' })
    );
    assert.equal(created.status, 201);
    const first = await created.json();
    assert.match(first.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(first).sort(), [
      'audit',
      'createdAt',
      'definitionId',
      'displayName',
      'id',
      'ownership',
      'schemaVersion',
      'state',
      'updatedAt'
    ]);
    assert.equal(first.state, 'draft');
    assert.equal(first.audit.status, 'recorded');
    const second = await (
      await POST(api('/api/v1/instances', 'POST', { definitionId: 'sonarr', displayName: 'TV', ownership: 'external' }))
    ).json();
    assert.notEqual(first.id, second.id);
    const page = await (await GET(api('/api/v1/instances?limit=1'))).json();
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
    const next = await (await GET(api(`/api/v1/instances?limit=1&cursor=${page.nextCursor}`))).json();
    assert.equal(next.items.length, 1);
    assert.notEqual(page.items[0].id, next.items[0].id);
    const renamed = await (
      await PATCH(api(`/api/v1/instances/${first.id}`, 'PATCH', { displayName: 'UHD' }), ctx(first.id))
    ).json();
    assert.equal(renamed.id, first.id);
    assert.equal(renamed.displayName, 'UHD');
    assert.equal(renamed.audit.status, 'recorded');
    assert.equal(
      (
        await PATCH(
          api(`/api/v1/instances/${first.id}`, 'PATCH', { displayName: 'Wrong', id: second.id }),
          ctx(first.id)
        )
      ).status,
      400
    );
    assert.equal(listDraftInstancesAction().items.find((item) => item.id === first.id)?.displayName, 'UHD');
    assert.equal(listDraftInstancesAction().items.find((item) => item.id === second.id)?.displayName, 'TV');
    assert.equal(listDraftInstancesAction().items.length, 2);
    for (const definitionId of ['radarr4k', 'sonarr4k', 'database', 'stackarr', 'not-real']) {
      assert.equal(
        (await POST(api('/api/v1/instances', 'POST', { definitionId, displayName: 'X', ownership: 'managed' }))).status,
        400
      );
    }
    for (const body of [
      { definitionId: 'sonarr', displayName: 'X', ownership: 'unowned' },
      { definitionId: 'sonarr', displayName: 'X', ownership: 'managed', secretReferences: { key: 'sensitive' } },
      { definitionId: 'sonarr', displayName: 'X' }
    ]) {
      assert.equal((await POST(api('/api/v1/instances', 'POST', body))).status, 400);
    }
    assert.equal(
      (
        await POST(
          new NextRequest('http://localhost/api/v1/instances', {
            method: 'POST',
            headers: { 'x-api-key': 'test-key' },
            body: '{'
          })
        )
      ).status,
      400
    );
    assert.equal((await GET(api('/api/v1/instances?limit=101'))).status, 400);
    assert.equal(
      (
        await POST(
          new NextRequest('http://localhost/api/v1/instances', {
            method: 'POST',
            headers: { 'x-api-key': 'test-key' },
            body: 'x'.repeat(16385)
          })
        )
      ).status,
      400
    );
    assert.equal(
      (await PATCH(api(`/api/v1/instances/${first.id}`, 'PATCH', { configuration: {} }), ctx(first.id))).status,
      400
    );
    assert.equal(
      (await DELETE(api(`/api/v1/instances/${first.id}`, 'DELETE', undefined, 'wrong'), ctx(first.id))).status,
      401
    );
    for (const body of [{ secretReferences: { key: 'fixture-only' } }, { id: second.id }, {}]) {
      assert.equal((await DELETE(api(`/api/v1/instances/${first.id}`, 'DELETE', body), ctx(first.id))).status, 400);
      assert.equal(listDraftInstancesAction().items.length, 2);
    }
    assert.equal((await DELETE(api(`/api/v1/instances/${first.id}`, 'DELETE'), ctx(first.id))).status, 200);
    assert.equal((await DELETE(api(`/api/v1/instances/${first.id}`, 'DELETE'), ctx(first.id))).status, 404);
    assert.equal(listDraftInstancesAction().items[0].id, second.id);
    const db = new DatabaseSync(path.join(root, 'draft.db'));
    try {
      assert.equal((db.prepare('select count(*) as count from app_instances').get() as { count: number }).count, 1);
      for (const version of [20260920, 20261107])
        assert.equal(
          (db.prepare('select version from schema_migrations where version = ?').get(version) as { version: number })
            .version,
          version
        );
      assert.equal(
        (db.prepare('select configuration from app_instances where id = ?').get(second.id) as { configuration: string })
          .configuration,
        '{}'
      );
    } finally {
      db.close();
    }
    assert.throws(() => renameDraftInstanceAction(first.id, { displayName: 'Gone' }), /not found/i);
    assert.throws(() => removeDraftInstanceAction(first.id), /not found/i);
    assert.equal(
      createDraftInstanceAction({ definitionId: 'plex', displayName: 'Media', ownership: 'native' }).state,
      'draft'
    );
  } finally {
    /* Parent cleans up after this process exits and releases SQLite. */
  }
});

test('catalog exactly reconciles registry and Compose service keys', () => {
  const service = readFileSync('packages/core/src/services.ts', 'utf8');
  const compose = readFileSync('stackarr/docker-compose.yml', 'utf8').split('\nvolumes:')[0];
  const registry = [...service.matchAll(/^  ([a-z0-9]+): \{\n    displayName:/gm)].map((match) => match[1]);
  const composeIds = [...compose.matchAll(/^  ([a-z0-9-]+):\n/gm)].map((match) => match[1]);
  const union = [...new Set([...registry, ...composeIds])].sort();
  assert.equal(registry.length, catalog.sourceCounts.registry);
  assert.equal(composeIds.length, catalog.sourceCounts.compose);
  assert.deepEqual(catalog.entries.map((entry) => entry.sourceId).sort(), union);
  assert.equal(catalog.entries.filter((entry) => entry.kind === 'definition').length, 24);
  assert.equal(catalog.entries.find((entry) => entry.sourceId === 'sonarr4k')?.definitionId, 'sonarr');
  assert.equal(catalog.entries.find((entry) => entry.sourceId === 'radarr4k')?.definitionId, 'radarr');
});

test('PostgreSQL failure refuses SQLite fallback; migration has bounded lock and version', () => {
  const dir = mkdtempSync(path.join(root, 'stackarr-pg-draft-'));
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const psql = path.join(bin, 'psql');
    const sqlite = path.join(dir, 'must-not-exist.db');
    const capture = path.join(dir, 'capture.sql');
    const env = {
      ...process.env,
      STACKARR_DATABASE_MODE: 'postgres',
      STACKARR_DATABASE_URL: 'postgres://user:pass@offline.invalid:5432/main',
      STACKARR_DATABASE_FILE: sqlite,
      NODE_ENV: 'test' as const,
      PATH: `${bin}:${process.env.PATH}`,
      PSQL_CAPTURE: capture
    };
    const run = (source: string) =>
      execFileSync(path.join(process.cwd(), 'packages/integration-tests/node_modules/.bin/tsx'), ['-e', source], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8'
      });
    writeFileSync(psql, '#!/bin/sh\nexit 1\n');
    chmodSync(psql, 0o755);
    assert.match(
      run(
        "import {listDraftInstancesAction} from './packages/core/src/instances.ts'; try { listDraftInstancesAction(); console.log('unexpected-success') } catch { console.log('refused') }"
      ),
      /refused/
    );
    assert.equal(existsSync(sqlite), false);
    writeFileSync(psql, '#!/bin/sh\ncat >> "$PSQL_CAPTURE"\nprintf "\\n--CALL--\\n" >> "$PSQL_CAPTURE"\nprintf "[]"\n');
    chmodSync(psql, 0o755);
    assert.match(
      run(
        "import {listDraftInstancesAction} from './packages/core/src/instances.ts'; console.log(JSON.stringify(listDraftInstancesAction()))"
      ),
      /"items":\[\]/
    );
    const sql = readFileSync(capture, 'utf8');
    assert.match(
      sql,
      /begin;\s*set local lock_timeout = '5s';\s*select pg_advisory_xact_lock\(hashtext\('stackarr:migrations'\)\)/
    );
    assert.match(sql, /create table if not exists app_instances/);
    assert.match(sql, /insert into schema_migrations \(version\) values \(20260920\)/);
    assert.match(sql, /alter table app_instances add column if not exists state text/);
    assert.match(sql, /insert into schema_migrations \(version\) values \(20261107\)/);
    assert.match(sql, /commit;/);
    assert.equal(existsSync(sqlite), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PostgreSQL mutation SQL is targeted and failed rename is a 503, never SQLite fallback', async () => {
  const dir = mkdtempSync(path.join(root, 'pg-mutation-'));
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const psql = path.join(bin, 'psql');
    const capture = path.join(dir, 'sql');
    const sqlite = path.join(dir, 'forbidden.db');
    const env = {
      NODE_ENV: 'test' as const,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      TMPDIR: root,
      STACKARR_DATA_DIR: root,
      DOCKER_HOST: `unix://${root}/absent-docker.sock`,
      DOCKER_CONFIG: path.join(root, 'docker-empty'),
      STACKARR_DATABASE_MODE: 'postgres',
      STACKARR_DATABASE_URL: 'postgres://user:pass@offline.invalid/main',
      STACKARR_DATABASE_FILE: sqlite,
      STACKARR_API_KEY: 'test-key',
      PSQL_CAPTURE: capture
    };
    const run = (source: string) =>
      execFileSync(path.join(process.cwd(), 'packages/integration-tests/node_modules/.bin/tsx'), ['-e', source], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8'
      });
    writeFileSync(
      psql,
      `#!/bin/sh
sql=$(cat)
printf '%s\n--CALL--\n' "$sql" >> "$PSQL_CAPTURE"
case "$sql" in
  *"with mutated as (update app_instances"*) exit 1;;
  *"with mutated as (insert into app_instances"*) printf '%s' '{"id":"test-id","definition_id":"sonarr","display_name":"TV","ownership":"managed","state":"draft","configuration":"{}","secret_references":"{}","created_at":"2026-01-01","updated_at":"2026-01-01"}';;
  *"delete from app_instances"*) printf '%s' 'test-id';;
  *"from app_instances where id >"*) printf '[]';;
esac
`
    );
    chmodSync(psql, 0o755);
    assert.match(
      run(
        "import {insertInstanceRow,renameInstanceRow,removeInstanceRow,readInstanceRowsPage} from './packages/core/src/database.ts'; console.log(insertInstanceRow({id:'test-id',definition_id:'sonarr',display_name:'TV',ownership:'managed',state:'draft',configuration:'{}',secret_references:'{}'}).id); try {renameInstanceRow('test-id','New')} catch {console.log('store-failed')} console.log(removeInstanceRow('test-id')); console.log(readInstanceRowsPage(2).length)"
      ),
      /test-id\nstore-failed\ntrue\n0/
    );
    const sql = readFileSync(capture, 'utf8');
    assert.match(sql, /with mutated as \(insert into app_instances[\s\S]*returning \*\)/);
    assert.match(sql, /with mutated as \(update app_instances[\s\S]*state = 'draft' returning \*\)/);
    assert.match(sql, /row_to_json\(item\)/);
    assert.match(sql, /delete from app_instances where id = 'test-id' and state = 'draft' returning id/);
    assert.match(sql, /from app_instances where id > '' order by id limit 2/);
    assert.doesNotMatch(sql, /from app_instances\s+order by created_at/);
    assert.equal(existsSync(sqlite), false);
    const id = '00000000-0000-4000-8000-000000000001';
    const response = run(
      `import {NextRequest} from 'next/server'; import {PATCH} from './apps/frontend/src/app/api/v1/instances/[id]/route.ts'; (async () => { const r=await PATCH(new NextRequest('http://localhost/api/v1/instances/${id}',{method:'PATCH',headers:{'x-api-key':'test-key','content-type':'application/json'},body:JSON.stringify({displayName:'New'})}),{params:Promise.resolve({id:'${id}'})}); console.log(r.status) })()`
    );
    assert.match(response, /503/);
    assert.equal(existsSync(sqlite), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
