import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  connectDraftInstancesAction,
  createDraftInstanceAction,
  disconnectDraftInstancesAction,
  InstanceActionError,
  listDraftInstanceConnectionsAction,
  removeDraftInstanceAction,
  renameDraftInstanceAction
} from '../../core/src/instances';

const create = (definitionId: string, displayName: string, ownership: 'managed' | 'external' | 'native' = 'managed') =>
  createDraftInstanceAction({ definitionId, displayName, ownership });
const kind = 'download-client' as const;
const errors = (fn: () => unknown, code: InstanceActionError['code']) =>
  assert.throws(fn, (error: unknown) => error instanceof InstanceActionError && error.code === code);

test('zero, shared and independent downloaders, identity and targeted removal', () => {
  const a = create('sonarr', 'TV');
  const b = create('sonarr', 'TV UHD', 'external');
  const c = create('radarr', 'Movies', 'native');
  const l = create('lidarr', 'Music');
  const q = create('qbittorrent', 'q');
  const t = create('transmission', 't');
  assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: a.id }), {
    schemaVersion: 1,
    items: [],
    nextCursor: null
  });
  const ab = { schemaVersion: 1, sourceId: a.id, targetId: q.id, kind };
  assert.deepEqual(connectDraftInstancesAction({ sourceId: a.id, targetId: q.id, kind }), ab);
  assert.deepEqual(connectDraftInstancesAction({ sourceId: a.id, targetId: q.id, kind }), ab);
  connectDraftInstancesAction({ sourceId: b.id, targetId: q.id, kind });
  connectDraftInstancesAction({ sourceId: c.id, targetId: t.id, kind });
  connectDraftInstancesAction({ sourceId: l.id, targetId: t.id, kind });
  renameDraftInstanceAction(a.id, { displayName: 'TV renamed' });
  assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: q.id }), {
    schemaVersion: 1,
    items: [ab, { schemaVersion: 1, sourceId: b.id, targetId: q.id, kind }].sort((x, y) =>
      x.sourceId.localeCompare(y.sourceId)
    ),
    nextCursor: null
  });
  const first = listDraftInstanceConnectionsAction({ instanceId: q.id, limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.nextCursor, `${first.items[0].sourceId}:${first.items[0].targetId}`);
  const second = listDraftInstanceConnectionsAction({ instanceId: q.id, limit: 1, cursor: first.nextCursor! });
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.notEqual(second.items[0].sourceId, first.items[0].sourceId);
  assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: c.id }).items, [
    { schemaVersion: 1, sourceId: c.id, targetId: t.id, kind }
  ]);
  assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: l.id }).items, [
    { schemaVersion: 1, sourceId: l.id, targetId: t.id, kind }
  ]);
  errors(() => removeDraftInstanceAction(a.id), 'conflict');
  errors(() => removeDraftInstanceAction(q.id), 'conflict');
  errors(() => removeDraftInstanceAction(t.id), 'conflict');
  assert.deepEqual(disconnectDraftInstancesAction({ sourceId: a.id, targetId: q.id, kind }), ab);
  assert.deepEqual(removeDraftInstanceAction(a.id), { id: a.id });
  assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: q.id }).items, [
    { schemaVersion: 1, sourceId: b.id, targetId: q.id, kind }
  ]);
  errors(() => removeDraftInstanceAction(q.id), 'conflict');
  disconnectDraftInstancesAction({ sourceId: b.id, targetId: q.id, kind });
  assert.deepEqual(removeDraftInstanceAction(q.id), { id: q.id });
});

test('invalid, absent, self and unsupported pairs fail closed without private payload', () => {
  const s = create('sonarr', 's');
  const q = create('qbittorrent', 'q');
  const absent = 'c1111111-1111-4111-8111-111111111111';
  for (const input of [
    { sourceId: s.id, targetId: s.id, kind },
    { sourceId: q.id, targetId: s.id, kind },
    { sourceId: s.id, targetId: s.id, kind: 'required' },
    { sourceId: 'bad', targetId: q.id, kind },
    { sourceId: s.id, targetId: q.id, kind, configuration: { password: 'private' } },
    { sourceId: s.id, targetId: q.id }
  ])
    errors(() => connectDraftInstancesAction(input as never), 'invalid_input');
  errors(() => connectDraftInstancesAction({ sourceId: absent, targetId: q.id, kind }), 'not_found');
  errors(() => connectDraftInstancesAction({ sourceId: s.id, targetId: absent, kind }), 'not_found');
  errors(() => listDraftInstanceConnectionsAction({ instanceId: absent }), 'not_found');
  errors(() => listDraftInstanceConnectionsAction({ instanceId: s.id, extra: true } as never), 'invalid_input');
  for (const input of [0, 101, '1', 1.5, Number.MAX_SAFE_INTEGER])
    errors(() => listDraftInstanceConnectionsAction({ instanceId: s.id, limit: input } as never), 'invalid_input');
  for (const cursor of ['bad', `${s.id}:bad`, `${s.id}:${q.id}:extra`, 123])
    errors(() => listDraftInstanceConnectionsAction({ instanceId: s.id, cursor } as never), 'invalid_input');
  errors(() => disconnectDraftInstancesAction({ sourceId: s.id, targetId: q.id, kind }), 'not_found');
  assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: s.id }).items, []);
});

test('disconnect refuses a transitioned endpoint and preserves its edge', () => {
  const s = create('sonarr', 'transition source');
  const q = create('qbittorrent', 'transition target');
  const edge = { sourceId: s.id, targetId: q.id, kind };
  connectDraftInstancesAction(edge);
  const db = new DatabaseSync(process.env.STACKARR_DATABASE_FILE!);
  try {
    const schema = (db.prepare("select sql from sqlite_schema where name='app_instances'").get() as { sql: string })
      .sql;
    const version = (db.prepare('pragma schema_version').get() as { schema_version: number }).schema_version;
    db.exec('pragma writable_schema=on');
    db.prepare("update sqlite_schema set sql=? where name='app_instances'").run(
      schema.replace("check (state = 'draft')", '')
    );
    db.exec(`pragma schema_version=${version + 1}; pragma writable_schema=off`);
    db.prepare("update app_instances set state = 'installed' where id = ?").run(q.id);
    errors(() => disconnectDraftInstancesAction(edge), 'not_found');
    assert.equal(
      (
        db
          .prepare('select count(*) as n from app_instance_connections where source_id=? and target_id=?')
          .get(s.id, q.id) as { n: number }
      ).n,
      1
    );
    db.prepare("update app_instances set state = 'draft' where id = ?").run(q.id);
    db.prepare("update app_instances set state = 'installed' where id = ?").run(s.id);
    errors(() => disconnectDraftInstancesAction(edge), 'not_found');
    assert.equal(
      (
        db
          .prepare('select count(*) as n from app_instance_connections where source_id=? and target_id=?')
          .get(s.id, q.id) as { n: number }
      ).n,
      1
    );
    db.prepare("update app_instances set state = 'draft' where id = ?").run(s.id);
    db.exec('pragma writable_schema=on');
    db.prepare("update sqlite_schema set sql=? where name='app_instances'").run(schema);
    db.exec(`pragma schema_version=${version + 2}; pragma writable_schema=off`);
  } finally {
    db.close();
  }
});

test('pairing matrix permits only optional downloader edges', () => {
  for (const source of ['sonarr', 'radarr', 'lidarr', 'plex', 'qbittorrent']) {
    for (const target of ['qbittorrent', 'transmission', 'plex', 'sonarr']) {
      const s = create(source, `source ${source}`),
        t = create(target, `target ${target}`);
      const edge = { sourceId: s.id, targetId: t.id, kind };
      if (['sonarr', 'radarr', 'lidarr'].includes(source) && ['qbittorrent', 'transmission'].includes(target)) {
        assert.equal(connectDraftInstancesAction(edge).sourceId, s.id);
        assert.equal(listDraftInstanceConnectionsAction({ instanceId: s.id }).items.length, 1);
      } else {
        errors(() => connectDraftInstancesAction(edge), 'invalid_input');
        assert.deepEqual(listDraftInstanceConnectionsAction({ instanceId: s.id }).items, []);
      }
    }
  }
});

test('real concurrent SQLite public actions: duplicate connect and connect versus delete', async () => {
  const root = process.env.STACKARR_DATA_DIR!;
  const tsx = path.join(process.cwd(), 'packages/integration-tests/node_modules/.bin/tsx');
  const runPair = async (operation: 'connect' | 'remove', s: string, t: string, label: string) => {
    const gate = path.join(root, `${label}-gate`);
    const script = `import {writeFileSync,existsSync} from 'node:fs'; import {connectDraftInstancesAction,removeDraftInstanceAction} from './packages/core/src/instances.ts';
      writeFileSync(process.env.READY!, 'ready'); while(!existsSync(process.env.GATE!)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      try {const result=process.env.OP==='connect' ? connectDraftInstancesAction({sourceId:process.env.SOURCE,targetId:process.env.TARGET,kind:'download-client'}) : removeDraftInstanceAction(process.env.SOURCE!); console.log(JSON.stringify({ok:true,result}));}
      catch(e){console.log(JSON.stringify({ok:false,code:e.code || 'untyped',message:e.message}));}`;
    const launch = (op: string, index: number) => {
      const ready = path.join(root, `${label}-${index}-ready`);
      const child = spawn(tsx, ['-e', script], {
        cwd: process.cwd(),
        env: { ...process.env, OP: op, SOURCE: s, TARGET: t, READY: ready, GATE: gate }
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const finished = new Promise<{ ok: boolean; code?: string; result?: unknown }>((resolve, reject) =>
        child.on('close', (status) => {
          if (status !== 0) return reject(new Error(`${op}: ${status}: ${stdout} ${stderr}`));
          try {
            resolve(JSON.parse(stdout.trim().split('\n').at(-1)!));
          } catch {
            reject(new Error(`${stdout} ${stderr}`));
          }
        })
      );
      return { ready, finished, child };
    };
    const a = launch('connect', 1),
      b = launch(operation, 2);
    try {
      const deadline = Date.now() + 15000;
      while ((!existsSync(a.ready) || !existsSync(b.ready)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(existsSync(a.ready) && existsSync(b.ready), 'both processes must reach barrier');
      writeFileSync(gate, 'go');
      return await Promise.all([a.finished, b.finished]);
    } finally {
      a.child.kill();
      b.child.kill();
      for (const file of [gate, a.ready, b.ready]) if (existsSync(file)) unlinkSync(file);
    }
  };
  const s = create('sonarr', 'concurrent source'),
    t = create('qbittorrent', 'concurrent target');
  const duplicates = await runPair('connect', s.id, t.id, 'duplicate');
  console.log('concurrent duplicate connect outcomes:', JSON.stringify(duplicates));
  assert.ok(
    duplicates.every((result) => result.ok),
    JSON.stringify(duplicates)
  );
  assert.equal(listDraftInstanceConnectionsAction({ instanceId: s.id }).items.length, 1);
  const s2 = create('sonarr', 'race source'),
    t2 = create('qbittorrent', 'race target');
  const race = await runPair('remove', s2.id, t2.id, 'delete-race');
  console.log('concurrent connect/delete outcomes:', JSON.stringify(race));
  assert.ok(race[0].ok || race[0].code === 'not_found', JSON.stringify(race));
  assert.ok(race[1].ok || race[1].code === 'conflict', JSON.stringify(race));
  assert.equal(race[0].ok, !race[1].ok, JSON.stringify(race));
  const db = new DatabaseSync(process.env.STACKARR_DATABASE_FILE!);
  try {
    assert.equal(
      (
        db
          .prepare(
            `select count(*) as n from app_instance_connections c left join app_instances s on s.id=c.source_id left join app_instances t on t.id=c.target_id where s.id is null or t.id is null`
          )
          .get() as { n: number }
      ).n,
      0
    );
  } finally {
    db.close();
  }
});
