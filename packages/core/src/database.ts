import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentActivityRecord } from './actions/agentActivity';
import { downloadClientSources, downloadClientTargets, isOptionalDownloadClientPair } from './instanceCatalog';
import { appDatabasePath } from './paths';
import type { StackarrTask } from './tasks';

type Database = InstanceType<typeof DatabaseSync>;
type StackarrDatabaseTarget = 'main' | 'log';
type SqliteInputValue = string | number | bigint | Uint8Array | null;

let database: Database | undefined;
let postgresMainMigrated = false;
let postgresLogMigrated = false;
const instancePlatformSchemaVersion = 20260920;
const instanceDraftSchemaVersion = 20261107;
const instanceConnectionSchemaVersion = 20261108;

type NotificationRow = {
  id: number;
  name: string;
  implementation: 'Webhook' | 'CustomScript';
  enabled: number | boolean;
  url?: string | null;
  path?: string | null;
  events: string;
};

type AgentActivityDbRow = {
  id: string;
  timestamp: string;
  caller: AgentActivityRecord['caller'];
  tool_name: string;
  category: string;
  scopes: string;
  risk: AgentActivityRecord['risk'];
  input_summary?: string | null;
  status: AgentActivityRecord['status'];
  duration_ms?: number | null;
  result_summary?: string | null;
  error?: string | null;
};

type TaskDbRow = {
  id: string;
  command_name: StackarrTask['commandName'];
  command_label: string;
  status: StackarrTask['status'];
  queued_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  exit_code?: number | null;
  output?: string | null;
  error?: string | null;
  reviewed_at?: string | null;
};

export type InstanceOwnership = 'managed' | 'external' | 'native';

export type InstanceDbRow = {
  id: string;
  definition_id: string;
  display_name: string;
  ownership: InstanceOwnership;
  state: 'draft';
  configuration: string;
  secret_references: string;
  created_at: string;
  updated_at: string;
};

export type InstanceConnectionRow = { source_id: string; target_id: string; kind: 'download-client' };
export class InstanceConnectionConflict extends Error {}
const sqlList = (ids: readonly string[]) => ids.map(sqlLiteral).join(',');

export function listInstanceConnectionRows(
  id: string,
  limit: number,
  cursor?: [string, string]
): InstanceConnectionRow[] {
  const after = cursor
    ? ` and (source_id > ${sqlLiteral(cursor[0])} or (source_id = ${sqlLiteral(cursor[0])} and target_id > ${sqlLiteral(cursor[1])}))`
    : '';
  if (postgresConfigured('main')) {
    if (!migratePostgres('main')) throw new Error('Postgres instance store unavailable.');
    return JSON.parse(
      runPsql(`select coalesce(json_agg(row_to_json(e) order by e.source_id, e.target_id), '[]'::json)
      from (select source_id, target_id, kind from app_instance_connections
        where (source_id = ${sqlLiteral(id)} or target_id = ${sqlLiteral(id)})${after}
        order by source_id, target_id limit ${limit}) e;`)
    ) as InstanceConnectionRow[];
  }
  return getSqliteDatabase()
    .prepare(`select source_id, target_id, kind from app_instance_connections
    where (source_id = ? or target_id = ?) and (? is null or source_id > ? or (source_id = ? and target_id > ?))
    order by source_id, target_id limit ?`)
    .all(
      id,
      id,
      cursor?.[0] ?? null,
      cursor?.[0] ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      limit
    ) as InstanceConnectionRow[];
}

export function readConnectionInstanceDefinitions(
  sourceId: string,
  targetId: string
): Array<{ id: string; definition_id: string }> {
  if (postgresConfigured('main')) {
    if (!migratePostgres('main')) throw new Error('Postgres instance store unavailable.');
    return JSON.parse(
      runPsql(`select coalesce(json_agg(row_to_json(e)), '[]'::json) from
      (select id, definition_id from app_instances where state = 'draft' and id in (${sqlLiteral(sourceId)}, ${sqlLiteral(targetId)})) e;`)
    );
  }
  return getSqliteDatabase()
    .prepare("select id, definition_id from app_instances where state = 'draft' and id in (?, ?)")
    .all(sourceId, targetId) as Array<{ id: string; definition_id: string }>;
}

export function connectInstanceRows(row: InstanceConnectionRow): boolean {
  if (postgresConfigured('main')) {
    if (!migratePostgres('main')) throw new Error('Postgres instance store unavailable.');
    const result = runPsql(`with parents as materialized (
      select id, definition_id from app_instances where state = 'draft' and id in (${sqlLiteral(row.source_id)}, ${sqlLiteral(row.target_id)})
      order by id for update), inserted as (
      insert into app_instance_connections(source_id, target_id, kind)
      select ${sqlLiteral(row.source_id)}, ${sqlLiteral(row.target_id)}, 'download-client'
      where (select definition_id from parents where id = ${sqlLiteral(row.source_id)}) in (${sqlList(downloadClientSources)})
        and (select definition_id from parents where id = ${sqlLiteral(row.target_id)}) in (${sqlList(downloadClientTargets)})
      on conflict (source_id,target_id,kind) do nothing returning source_id)
      select case when (select definition_id from parents where id = ${sqlLiteral(row.source_id)}) in (${sqlList(downloadClientSources)})
        and (select definition_id from parents where id = ${sqlLiteral(row.target_id)}) in (${sqlList(downloadClientTargets)})
        then 'ok' else 'missing' end from (select count(*) from inserted) completed;`);
    return result === 'ok';
  }
  const db = getSqliteDatabase();
  db.exec('begin immediate');
  try {
    const parents = db
      .prepare("select id, definition_id from app_instances where state = 'draft' and id in (?, ?)")
      .all(row.source_id, row.target_id) as Array<{ id: string; definition_id: string }>;
    const source = parents.find((p) => p.id === row.source_id);
    const target = parents.find((p) => p.id === row.target_id);
    const valid = !!source && !!target && isOptionalDownloadClientPair(source.definition_id, target.definition_id);
    if (valid)
      db.prepare(`insert into app_instance_connections(source_id,target_id,kind) values (?,?,'download-client')
      on conflict(source_id,target_id,kind) do nothing`).run(row.source_id, row.target_id);
    db.exec('commit');
    return valid;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}

export function disconnectInstanceRows(row: InstanceConnectionRow): boolean {
  if (postgresConfigured('main')) {
    if (!migratePostgres('main')) throw new Error('Postgres instance store unavailable.');
    return (
      runPsql(`with parents as materialized (
      select id from app_instances where state = 'draft' and id in (${sqlLiteral(row.source_id)}, ${sqlLiteral(row.target_id)})
      order by id for update), removed as (
      delete from app_instance_connections where source_id = ${sqlLiteral(row.source_id)}
      and target_id = ${sqlLiteral(row.target_id)} and kind = 'download-client'
      and (select count(*) from parents) = 2 returning source_id)
      select coalesce((select source_id from removed), 'missing');`) === row.source_id
    );
  }
  const db = getSqliteDatabase();
  db.exec('begin immediate');
  try {
    const parents = db
      .prepare("select id from app_instances where state='draft' and id in (?, ?)")
      .all(row.source_id, row.target_id);
    const changed =
      parents.length === 2 &&
      Number(
        db
          .prepare(`delete from app_instance_connections where source_id=? and target_id=? and kind='download-client'`)
          .run(row.source_id, row.target_id).changes
      ) === 1;
    db.exec('commit');
    return changed;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}

export function getDatabase() {
  if (postgresConfigured('main')) {
    throw new Error('Stackarr is configured for PostgreSQL; use database helper functions instead of getDatabase().');
  }

  return getSqliteDatabase();
}

function getSqliteDatabase() {
  if (!database) {
    fs.mkdirSync(path.dirname(appDatabasePath), { recursive: true });
    database = new DatabaseSync(appDatabasePath);
    database.exec('pragma busy_timeout = 5000');
    database.exec('pragma foreign_keys = on');
    migrate(database);
  }

  return database;
}

export function databaseExists() {
  if (postgresConfigured('main')) {
    return migratePostgres('main');
  }

  return fs.existsSync(appDatabasePath);
}

export function readJsonSetting<T>(key: string, fallback: T): T {
  let row: { value?: string } | undefined;

  if (postgresConfigured('main')) {
    row = readPostgresSetting(key);
  } else {
    if (!databaseExists()) {
      return fallback;
    }

    if (fs.existsSync(appDatabasePath)) {
      row = readSqliteSetting(key);
    }
  }

  if (!row?.value) {
    return fallback;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonSetting<T>(key: string, value: T) {
  const jsonValue = JSON.stringify(value);

  if (postgresConfigured('main')) {
    if (!writePostgresSetting(key, jsonValue)) {
      throw new Error(`Postgres setting write failed for ${key}.`);
    }

    return;
  }

  writeSqliteSetting(key, jsonValue);
}

export function readInstanceRowsPage(limit: number, cursor?: string): InstanceDbRow[] {
  if (postgresConfigured('main')) {
    if (!migratePostgres('main')) throw new Error('Postgres instance store is unavailable.');
    try {
      const result = runPsql(`select coalesce(json_agg(row_to_json(items)), '[]'::json) from (
        select id, definition_id, display_name, ownership, state, configuration::text as configuration,
          secret_references::text as secret_references,
          to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
          to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
        from app_instances where id > ${sqlLiteral(cursor ?? '')} order by id limit ${limit}
      ) items;`);
      return JSON.parse(result) as InstanceDbRow[];
    } catch {
      throw new Error('Postgres instance store is unavailable.');
    }
  }
  return getSqliteDatabase()
    .prepare(`select id, definition_id, display_name, ownership, state,
    configuration, secret_references, created_at, updated_at from app_instances
    where id > ? order by id limit ?`)
    .all(cursor ?? '', limit) as InstanceDbRow[];
}

export function insertInstanceRow(row: Omit<InstanceDbRow, 'created_at' | 'updated_at'>): InstanceDbRow {
  validatePrivateJson(row.configuration);
  validatePrivateJson(row.secret_references, true);
  if (row.state !== 'draft') throw new Error('Only draft instance records can be inserted.');
  if (postgresConfigured('main')) {
    const inserted = insertPostgresInstanceRow(row);
    if (inserted) return inserted;
    throw new Error('Postgres instance insert failed.');
  }

  return getSqliteDatabase()
    .prepare(
      `insert into app_instances (id, definition_id, display_name, ownership, state, configuration, secret_references)
       values (?, ?, ?, ?, 'draft', ?, ?)
       returning id, definition_id, display_name, ownership, state, configuration, secret_references, created_at, updated_at`
    )
    .get(
      row.id,
      row.definition_id,
      row.display_name,
      row.ownership,
      row.configuration,
      row.secret_references
    ) as InstanceDbRow;
}

export function renameInstanceRow(id: string, displayName: string): InstanceDbRow | undefined {
  if (postgresConfigured('main')) {
    return renamePostgresInstanceRow(id, displayName);
  }

  return getSqliteDatabase()
    .prepare(
      `update app_instances
       set display_name = ?, updated_at = datetime('now')
       where id = ? and state = 'draft'
       returning id, definition_id, display_name, ownership, state, configuration, secret_references, created_at, updated_at`
    )
    .get(displayName, id) as InstanceDbRow | undefined;
}

export function removeInstanceRow(id: string): boolean {
  if (postgresConfigured('main')) {
    return removePostgresInstanceRow(id);
  }

  const db = getSqliteDatabase();
  db.exec('begin immediate');
  try {
    if (db.prepare('select 1 from app_instance_connections where source_id = ? or target_id = ? limit 1').get(id, id))
      throw new InstanceConnectionConflict('Draft instance has connections.');
    const result = db.prepare("delete from app_instances where id = ? and state = 'draft'").run(id);
    db.exec('commit');
    return Number(result.changes ?? 0) === 1;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}

function validatePrivateJson(value: string, stringValues = false) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid private instance JSON.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (stringValues && Object.values(parsed).some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error('Invalid private instance JSON.');
  }
}

function readSqliteSetting(key: string): { value?: string } | undefined {
  return getSqliteDatabase().prepare('select value from app_settings where key = ?').get(key) as
    | { value?: string }
    | undefined;
}

function writeSqliteSetting(key: string, value: string) {
  getSqliteDatabase()
    .prepare(`
      insert into app_settings (key, value, updated_at)
      values (?, ?, datetime('now'))
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `)
    .run(key, value);
}

export function readNotificationRows(): NotificationRow[] {
  if (postgresConfigured('main')) {
    return readPostgresNotifications() ?? [];
  }

  if (!fs.existsSync(appDatabasePath)) {
    return [];
  }

  return getSqliteDatabase()
    .prepare('select id, name, implementation, enabled, url, path, events from notifications order by name')
    .all() as NotificationRow[];
}

export function insertNotificationRow(notification: Omit<NotificationRow, 'id'>): number {
  if (postgresConfigured('main')) {
    const id = insertPostgresNotification(notification);
    if (id) {
      return id;
    }

    throw new Error('Postgres notification insert failed.');
  }

  const result = getSqliteDatabase()
    .prepare(`
      insert into notifications (name, implementation, enabled, url, path, events, updated_at)
      values (?, ?, ?, ?, ?, ?, datetime('now'))
      returning id
    `)
    .get(
      notification.name,
      notification.implementation,
      notification.enabled ? 1 : 0,
      notification.url ?? null,
      notification.path ?? null,
      notification.events
    ) as { id: number };

  return result.id;
}

export function readAgentActivityRows(limit = 100): AgentActivityRecord[] | undefined {
  if (postgresConfigured('log')) {
    return readPostgresAgentActivity(limit);
  }

  try {
    const rows = getSqliteDatabase()
      .prepare(`
        select
          id,
          timestamp,
          caller,
          tool_name,
          category,
          scopes,
          risk,
          input_summary,
          status,
          duration_ms,
          result_summary,
          error
        from agent_activity
        order by timestamp desc
        limit ?
      `)
      .all(limit) as unknown as AgentActivityDbRow[];
    return rows.map(agentActivityFromDbRow);
  } catch {
    return undefined;
  }
}

export function insertAgentActivityRow(record: AgentActivityRecord) {
  if (postgresConfigured('log')) {
    return insertPostgresAgentActivity(record);
  }

  try {
    getSqliteDatabase()
      .prepare(`
        insert into agent_activity (
          id,
          timestamp,
          caller,
          tool_name,
          category,
          scopes,
          risk,
          input_summary,
          status,
          duration_ms,
          result_summary,
          error,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        on conflict(id) do update set
          timestamp = excluded.timestamp,
          caller = excluded.caller,
          tool_name = excluded.tool_name,
          category = excluded.category,
          scopes = excluded.scopes,
          risk = excluded.risk,
          input_summary = excluded.input_summary,
          status = excluded.status,
          duration_ms = excluded.duration_ms,
          result_summary = excluded.result_summary,
          error = excluded.error,
          updated_at = excluded.updated_at
      `)
      .run(...agentActivitySqliteValues(record));
    return true;
  } catch {
    return false;
  }
}

export function updateAgentActivityRow(id: string, patch: Partial<AgentActivityRecord>) {
  if (postgresConfigured('log')) {
    return updatePostgresAgentActivity(id, patch);
  }

  try {
    const current = getSqliteDatabase()
      .prepare(`
        select
          id,
          timestamp,
          caller,
          tool_name,
          category,
          scopes,
          risk,
          input_summary,
          status,
          duration_ms,
          result_summary,
          error
        from agent_activity
        where id = ?
      `)
      .get(id) as AgentActivityDbRow | undefined;

    if (!current) {
      return false;
    }

    return insertAgentActivityRow({ ...agentActivityFromDbRow(current), ...patch });
  } catch {
    return false;
  }
}

export function readTaskRows(): StackarrTask[] | undefined {
  if (postgresConfigured('main')) {
    return readPostgresTasks() ?? [];
  }

  try {
    const rows = getSqliteDatabase()
      .prepare(`
        select
          id,
          command_name,
          command_label,
          status,
          queued_at,
          started_at,
          ended_at,
          exit_code,
          output,
          error,
          reviewed_at
        from tasks
        order by queued_at desc
        limit 100
      `)
      .all() as unknown as TaskDbRow[];
    return rows.map(taskFromDbRow);
  } catch {
    return undefined;
  }
}

export function writeTaskRows(tasks: StackarrTask[]) {
  if (postgresConfigured('main')) {
    if (!writePostgresTasks(tasks)) {
      throw new Error('Postgres task write failed.');
    }

    return true;
  }

  const db = getSqliteDatabase();
  try {
    db.exec('begin immediate');
    for (const task of tasks) {
      upsertSqliteTask(task);
    }
    pruneSqliteTasks();
    db.exec('commit');
    return true;
  } catch {
    try {
      db.exec('rollback');
    } catch {
      // Ignore rollback failures; callers will fall back to file storage.
    }
    return false;
  }
}

export function insertTaskRow(task: StackarrTask) {
  if (postgresConfigured('main')) {
    if (!insertPostgresTask(task)) {
      throw new Error('Postgres task insert failed.');
    }

    return true;
  }

  const db = getSqliteDatabase();
  try {
    db.exec('begin immediate');
    upsertSqliteTask(task);
    pruneSqliteTasks();
    db.exec('commit');
    return true;
  } catch {
    try {
      db.exec('rollback');
    } catch {
      // Ignore rollback failures; callers will fall back to file storage.
    }
    return false;
  }
}

export function updateTaskRow(id: string, patch: Partial<StackarrTask>) {
  if (postgresConfigured('main')) {
    if (!updatePostgresTask(id, patch)) {
      throw new Error('Postgres task update failed.');
    }

    return true;
  }

  const entries = taskPatchSqliteEntries(patch);
  if (entries.length === 0) {
    return true;
  }

  try {
    const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
    const result = getSqliteDatabase()
      .prepare(`
        update tasks
        set ${assignments},
          updated_at = datetime('now')
        where id = ?
      `)
      .run(...entries.map(([, value]) => value), id);
    return Number(result.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

function upsertSqliteTask(task: StackarrTask) {
  getSqliteDatabase()
    .prepare(`
      insert into tasks (
        id,
        command_name,
        command_label,
        status,
        queued_at,
        started_at,
        ended_at,
        exit_code,
        output,
        error,
        reviewed_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      on conflict(id) do update set
        command_name = excluded.command_name,
        command_label = excluded.command_label,
        status = excluded.status,
        queued_at = excluded.queued_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        exit_code = excluded.exit_code,
        output = excluded.output,
        error = excluded.error,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at
    `)
    .run(...taskSqliteValues(task));
}

function pruneSqliteTasks() {
  getSqliteDatabase().exec(`
    delete from tasks
    where id not in (
      select id from tasks order by queued_at desc limit 100
    )
  `);
}

function migrate(db: Database) {
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      applied_at text not null default (datetime('now'))
    );

    create table if not exists app_settings (
      key text primary key,
      value text not null,
      updated_at text not null default (datetime('now'))
    );

    create table if not exists notifications (
      id integer primary key autoincrement,
      name text not null,
      implementation text not null,
      enabled integer not null default 1,
      url text,
      path text,
      events text not null,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists agent_activity (
      id text primary key,
      timestamp text not null,
      caller text not null,
      tool_name text not null,
      category text not null,
      scopes text not null,
      risk text not null,
      input_summary text,
      status text not null,
      duration_ms integer,
      result_summary text,
      error text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists agent_activity_timestamp_idx on agent_activity(timestamp);

    create table if not exists tasks (
      id text primary key,
      command_name text not null,
      command_label text not null,
      status text not null,
      queued_at text not null,
      started_at text,
      ended_at text,
      exit_code integer,
      output text,
      error text,
      reviewed_at text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists tasks_queued_at_idx on tasks(queued_at);
  `);

  const taskColumns = db.prepare('pragma table_info(tasks)').all() as unknown as Array<{ name: string }>;
  if (!taskColumns.some((column) => column.name === 'reviewed_at')) {
    db.exec('alter table tasks add column reviewed_at text');
  }

  migrateInstancePlatformSqlite(db);
}

function migrateInstancePlatformSqlite(db: Database) {
  db.exec('begin immediate');
  try {
    const applied = db
      .prepare('select 1 from schema_migrations where version = ?')
      .get(instancePlatformSchemaVersion) as { 1: number } | undefined;
    if (applied) {
      migrateInstanceDraftSqlite(db);
      migrateInstanceConnectionsSqlite(db);
      db.exec('commit');
      return;
    }
    db.exec(`
      create table if not exists app_instances (
        id text primary key,
        definition_id text not null,
        display_name text not null,
        ownership text not null check (ownership in ('managed', 'external', 'native')),
        configuration text not null default '{}',
        secret_references text not null default '{}',
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );
      create index if not exists app_instances_definition_id_idx on app_instances(definition_id);
      insert into schema_migrations (version) values (${instancePlatformSchemaVersion});
    `);
    // Both versions are stamped only after the atomic upgrade succeeds.
    migrateInstanceDraftSqlite(db);
    migrateInstanceConnectionsSqlite(db);
    db.exec('commit');
  } catch (error) {
    try {
      db.exec('rollback');
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

function migrateInstanceDraftSqlite(db: Database) {
  if (db.prepare('select 1 from schema_migrations where version = ?').get(instanceDraftSchemaVersion)) return;
  db.exec(`
    alter table app_instances add column state text not null default 'draft' check (state = 'draft');
    insert into schema_migrations (version) values (${instanceDraftSchemaVersion});
  `);
}
function migrateInstanceConnectionsSqlite(db: Database) {
  if (db.prepare('select 1 from schema_migrations where version = ?').get(instanceConnectionSchemaVersion)) return;
  db.exec(`create table app_instance_connections (
    source_id text not null references app_instances(id) on delete restrict,
    target_id text not null references app_instances(id) on delete restrict,
    kind text not null check (kind = 'download-client'),
    check (source_id <> target_id), unique(source_id, target_id, kind));
    create index app_instance_connections_target_idx on app_instance_connections(target_id);
    insert into schema_migrations (version) values (${instanceConnectionSchemaVersion});`);
}

function postgresConfigured(target: StackarrDatabaseTarget) {
  return process.env.STACKARR_DATABASE_MODE?.trim().toLowerCase() === 'postgres' || Boolean(resolvePostgresUrl(target));
}

function migratePostgres(target: StackarrDatabaseTarget) {
  if (target === 'main' && postgresMainMigrated) {
    return true;
  }
  if (target === 'log' && postgresLogMigrated) {
    return true;
  }

  try {
    if (target === 'main') {
      runPsql(
        `
      begin;
      set local lock_timeout = '5s';
      select pg_advisory_xact_lock(hashtext('stackarr:migrations'));

      create table if not exists schema_migrations (
        version integer primary key,
        applied_at timestamptz not null default now()
      );

      create table if not exists app_settings (
        key text primary key,
        value text not null,
        updated_at timestamptz not null default now()
      );

      create table if not exists notifications (
        id integer generated by default as identity primary key,
        name text not null,
        implementation text not null,
        enabled boolean not null default true,
        url text,
        path text,
        events text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists tasks (
        id text primary key,
        command_name text not null,
        command_label text not null,
        status text not null,
        queued_at timestamptz not null,
        started_at timestamptz,
        ended_at timestamptz,
        exit_code integer,
        output text,
        error text,
        reviewed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists tasks_queued_at_idx on tasks(queued_at);
      alter table tasks add column if not exists reviewed_at timestamptz;

      create table if not exists app_instances (
        id text primary key, definition_id text not null, display_name text not null,
        ownership text not null check (ownership in ('managed', 'external', 'native')),
        configuration jsonb not null default '{}'::jsonb,
        secret_references jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create index if not exists app_instances_definition_id_idx on app_instances(definition_id);
      insert into schema_migrations (version) values (${instancePlatformSchemaVersion}) on conflict do nothing;
      do $$ begin
        if not exists (select 1 from schema_migrations where version = ${instanceDraftSchemaVersion}) then
          alter table app_instances add column if not exists state text;
          update app_instances set state = 'draft' where state is null;
          alter table app_instances alter column state set default 'draft';
          alter table app_instances alter column state set not null;
        if not exists (select 1 from pg_constraint where conrelid = 'app_instances'::regclass and conname = 'app_instances_state_draft_check') then
          alter table app_instances add constraint app_instances_state_draft_check check (state = 'draft');
        end if;
          insert into schema_migrations (version) values (${instanceDraftSchemaVersion}) on conflict do nothing;
        end if;
      end $$;
      do $$ begin
        if not exists (select 1 from schema_migrations where version = ${instanceConnectionSchemaVersion}) then
          create table app_instance_connections (
            source_id text not null references app_instances(id) on delete restrict,
            target_id text not null references app_instances(id) on delete restrict,
            kind text not null check (kind = 'download-client'),
            check (source_id <> target_id), unique(source_id, target_id, kind));
          create index app_instance_connections_target_idx on app_instance_connections(target_id);
          insert into schema_migrations(version) values (${instanceConnectionSchemaVersion});
        end if;
      end $$;
      commit;
    `,
        {},
        false,
        'main'
      );
      postgresMainMigrated = true;
      return true;
    }

    runPsql(
      `
      begin;
      set local lock_timeout = '5s';
      select pg_advisory_xact_lock(hashtext('stackarr:migrations'));

      create table if not exists schema_migrations (
        version integer primary key,
        applied_at timestamptz not null default now()
      );

      create table if not exists agent_activity (
        id text primary key,
        timestamp timestamptz not null,
        caller text not null,
        tool_name text not null,
        category text not null,
        scopes jsonb not null,
        risk text not null,
        input_summary jsonb,
        status text not null,
        duration_ms integer,
        result_summary jsonb,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists agent_activity_timestamp_idx on agent_activity(timestamp);
      commit;
    `,
      {},
      false,
      'log'
    );
    postgresLogMigrated = true;
    return true;
  } catch {
    return false;
  }
}

function readPostgresSetting(key: string): { value?: string } | undefined {
  if (!migratePostgres('main')) {
    throw new Error('Postgres settings store is unavailable.');
  }

  try {
    const value = runPsql(`select value from app_settings where key = ${sqlLiteral(key)};`);
    return value ? { value } : undefined;
  } catch {
    throw new Error(`Postgres setting read failed for ${key}.`);
  }
}

function writePostgresSetting(key: string, value: string) {
  if (!migratePostgres('main')) {
    return false;
  }

  try {
    runPsql(
      `
        insert into app_settings (key, value, updated_at)
        values (${sqlLiteral(key)}, ${sqlLiteral(value)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
      `,
      {},
      false
    );
    return true;
  } catch {
    return false;
  }
}

// Project the mutated row in the same SQL statement; zero rows means not found,
// while psql failure throws and is never confused with an empty result.
function postgresInstanceMutation(sql: string): InstanceDbRow | undefined {
  if (!migratePostgres('main')) throw new Error('Postgres instance store is unavailable.');
  const value = runPsql(`with mutated as (${sql} returning *)
    select row_to_json(item) from (
      select id, definition_id, display_name, ownership, state,
        configuration::text as configuration, secret_references::text as secret_references,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from mutated
    ) item;`);
  return value ? (JSON.parse(value) as InstanceDbRow) : undefined;
}

function insertPostgresInstanceRow(row: Omit<InstanceDbRow, 'created_at' | 'updated_at'>): InstanceDbRow {
  const inserted = postgresInstanceMutation(`insert into app_instances
    (id, definition_id, display_name, ownership, state, configuration, secret_references)
    values (${sqlLiteral(row.id)}, ${sqlLiteral(row.definition_id)}, ${sqlLiteral(row.display_name)},
      ${sqlLiteral(row.ownership)}, 'draft', ${sqlLiteral(row.configuration)}::jsonb,
      ${sqlLiteral(row.secret_references)}::jsonb)`);
  if (!inserted) throw new Error('Postgres instance insert returned no row.');
  return inserted;
}

function renamePostgresInstanceRow(id: string, displayName: string): InstanceDbRow | undefined {
  return postgresInstanceMutation(`update app_instances set display_name = ${sqlLiteral(displayName)}, updated_at = now()
    where id = ${sqlLiteral(id)} and state = 'draft'`);
}

function removePostgresInstanceRow(id: string): boolean {
  if (!migratePostgres('main')) throw new Error('Postgres instance store is unavailable.');
  const result = runPsql(`begin;
    do $$ begin perform id from app_instances where id = ${sqlLiteral(id)} and state = 'draft' for update; end $$;
    with blocked as materialized
    (select 1 from app_instance_connections where source_id = ${sqlLiteral(id)} or target_id = ${sqlLiteral(id)} limit 1),
    removed as (delete from app_instances where id = ${sqlLiteral(id)} and state = 'draft'
      and not exists(select 1 from blocked) returning id)
    select case when exists(select 1 from blocked) then 'conflict'
      when exists(select 1 from removed) then 'removed' else 'missing' end;
    commit;`);
  if (result === 'conflict') throw new InstanceConnectionConflict('Draft instance has connections.');
  return result === 'removed';
}

function readPostgresNotifications(): NotificationRow[] | undefined {
  if (!migratePostgres('main')) {
    return undefined;
  }

  try {
    const value = runPsql(`
      select coalesce(json_agg(row_to_json(items)), '[]'::json)
      from (
        select id, name, implementation, enabled, url, path, events
        from notifications
        order by name
      ) items;
    `);
    return JSON.parse(value || '[]') as NotificationRow[];
  } catch {
    return undefined;
  }
}

function insertPostgresNotification(notification: Omit<NotificationRow, 'id'>): number | undefined {
  if (!migratePostgres('main')) {
    return undefined;
  }

  try {
    const value = runPsql(
      `
        insert into notifications (name, implementation, enabled, url, path, events, updated_at)
        values (
          ${sqlLiteral(notification.name)},
          ${sqlLiteral(notification.implementation)},
          ${notification.enabled ? 'true' : 'false'},
          nullif(${sqlLiteral(notification.url ?? '')}, ''),
          nullif(${sqlLiteral(notification.path ?? '')}, ''),
          ${sqlLiteral(notification.events)},
          now()
        )
        returning id;
      `,
      {}
    );
    const id = Number(value);
    return Number.isFinite(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function readPostgresAgentActivity(limit: number): AgentActivityRecord[] | undefined {
  if (!migratePostgres('log')) {
    return undefined;
  }

  try {
    const value = runPsql(
      `
      select coalesce(json_agg(row_to_json(items)), '[]'::json)
      from (
        select
          id,
          to_char(timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as timestamp,
          caller,
          tool_name,
          category,
          scopes::text as scopes,
          risk,
          input_summary::text as input_summary,
          status,
          duration_ms,
          result_summary::text as result_summary,
          error
        from agent_activity
        order by timestamp desc
        limit ${sqlInteger(limit, 100)}
      ) items;
    `,
      {},
      true,
      'log'
    );
    return (JSON.parse(value || '[]') as AgentActivityDbRow[]).map(agentActivityFromDbRow);
  } catch {
    return undefined;
  }
}

function insertPostgresAgentActivity(record: AgentActivityRecord) {
  if (!migratePostgres('log')) {
    return false;
  }

  try {
    runPsql(
      `
        insert into agent_activity (
          id,
          timestamp,
          caller,
          tool_name,
          category,
          scopes,
          risk,
          input_summary,
          status,
          duration_ms,
          result_summary,
          error,
          updated_at
        )
        values (
          ${sqlLiteral(record.id)},
          ${sqlLiteral(record.timestamp)}::timestamptz,
          ${sqlLiteral(record.caller)},
          ${sqlLiteral(record.toolName)},
          ${sqlLiteral(record.category)},
          ${sqlJson(record.scopes ?? [])},
          ${sqlLiteral(record.risk)},
          ${sqlJson(record.inputSummary)},
          ${sqlLiteral(record.status)},
          ${sqlNullableInteger(record.durationMs)},
          ${sqlJson(record.resultSummary)},
          nullif(${sqlLiteral(record.error ?? '')}, ''),
          now()
        )
        on conflict (id) do update set
          timestamp = excluded.timestamp,
          caller = excluded.caller,
          tool_name = excluded.tool_name,
          category = excluded.category,
          scopes = excluded.scopes,
          risk = excluded.risk,
          input_summary = excluded.input_summary,
          status = excluded.status,
          duration_ms = excluded.duration_ms,
          result_summary = excluded.result_summary,
          error = excluded.error,
          updated_at = excluded.updated_at;
      `,
      {},
      false,
      'log'
    );
    return true;
  } catch {
    return false;
  }
}

function updatePostgresAgentActivity(id: string, patch: Partial<AgentActivityRecord>) {
  const current = readPostgresAgentActivityRecord(id);
  if (!current) {
    return false;
  }

  return insertPostgresAgentActivity({ ...current, ...patch });
}

function readPostgresAgentActivityRecord(id: string): AgentActivityRecord | undefined {
  if (!migratePostgres('log')) {
    return undefined;
  }

  try {
    const value = runPsql(
      `
      select coalesce(json_agg(row_to_json(items)), '[]'::json)
      from (
        select
          id,
          to_char(timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as timestamp,
          caller,
          tool_name,
          category,
          scopes::text as scopes,
          risk,
          input_summary::text as input_summary,
          status,
          duration_ms,
          result_summary::text as result_summary,
          error
        from agent_activity
        where id = ${sqlLiteral(id)}
        limit 1
      ) items;
    `,
      {},
      true,
      'log'
    );
    return (JSON.parse(value || '[]') as AgentActivityDbRow[]).map(agentActivityFromDbRow)[0];
  } catch {
    return undefined;
  }
}

function readPostgresTasks(): StackarrTask[] | undefined {
  if (!migratePostgres('main')) {
    return undefined;
  }

  try {
    const value = runPsql(`
      select coalesce(json_agg(row_to_json(items)), '[]'::json)
      from (
        select
          id,
          command_name,
          command_label,
          status,
          to_char(queued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as queued_at,
          to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as started_at,
          to_char(ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ended_at,
          exit_code,
          output,
          error,
          to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as reviewed_at
        from tasks
        order by queued_at desc
        limit 100
      ) items;
    `);
    return (JSON.parse(value || '[]') as TaskDbRow[]).map(taskFromDbRow);
  } catch {
    return undefined;
  }
}

function writePostgresTasks(tasks: StackarrTask[]) {
  if (!migratePostgres('main')) {
    return false;
  }

  const insertSql =
    tasks.length > 0
      ? `
        insert into tasks (
          id,
          command_name,
          command_label,
          status,
          queued_at,
          started_at,
          ended_at,
          exit_code,
          output,
          error,
          reviewed_at,
          updated_at
        )
        values ${tasks.map(taskPostgresValues).join(',\n')}
        on conflict (id) do update set
          command_name = excluded.command_name,
          command_label = excluded.command_label,
          status = excluded.status,
          queued_at = excluded.queued_at,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          exit_code = excluded.exit_code,
          output = excluded.output,
          error = excluded.error,
          reviewed_at = excluded.reviewed_at,
          updated_at = excluded.updated_at;
      `
      : '';

  try {
    runPsql(
      `
        begin;
        ${insertSql}
        delete from tasks
        where id in (
          select id from tasks order by queued_at desc offset 100
        );
        commit;
      `,
      {},
      false
    );
    return true;
  } catch {
    return false;
  }
}

function insertPostgresTask(task: StackarrTask) {
  return writePostgresTasks([task]);
}

function updatePostgresTask(id: string, patch: Partial<StackarrTask>) {
  if (!migratePostgres('main')) {
    return false;
  }

  const entries = taskPatchPostgresEntries(patch);
  if (entries.length === 0) {
    return true;
  }

  try {
    runPsql(
      `
        update tasks
        set ${entries.map(([column, value]) => `${column} = ${value}`).join(', ')},
          updated_at = now()
        where id = ${sqlLiteral(id)};
      `,
      {},
      false
    );
    return true;
  } catch {
    return false;
  }
}

function agentActivitySqliteValues(record: AgentActivityRecord) {
  return [
    record.id,
    record.timestamp,
    record.caller,
    record.toolName,
    record.category,
    JSON.stringify(record.scopes ?? []),
    record.risk,
    jsonText(record.inputSummary),
    record.status,
    record.durationMs ?? null,
    jsonText(record.resultSummary),
    record.error ?? null
  ];
}

function taskSqliteValues(task: StackarrTask) {
  return [
    task.id,
    task.commandName,
    task.commandLabel,
    task.status,
    task.queuedAt,
    task.startedAt ?? null,
    task.endedAt ?? null,
    task.exitCode ?? null,
    task.output ?? null,
    task.error ?? null,
    task.reviewedAt ?? null
  ];
}

function taskPostgresValues(task: StackarrTask) {
  return `(
    ${sqlLiteral(task.id)},
    ${sqlLiteral(task.commandName)},
    ${sqlLiteral(task.commandLabel)},
    ${sqlLiteral(task.status)},
    ${sqlLiteral(task.queuedAt)}::timestamptz,
    ${sqlNullableTimestamp(task.startedAt)},
    ${sqlNullableTimestamp(task.endedAt)},
    ${sqlNullableInteger(task.exitCode)},
    ${sqlNullableText(task.output)},
    ${sqlNullableText(task.error)},
    ${sqlNullableTimestamp(task.reviewedAt)},
    now()
  )`;
}

function taskPatchSqliteEntries(patch: Partial<StackarrTask>): Array<[string, SqliteInputValue]> {
  const entries: Array<[string, SqliteInputValue]> = [];
  if (patch.commandName !== undefined) entries.push(['command_name', patch.commandName]);
  if (patch.commandLabel !== undefined) entries.push(['command_label', patch.commandLabel]);
  if (patch.status !== undefined) entries.push(['status', patch.status]);
  if (patch.queuedAt !== undefined) entries.push(['queued_at', patch.queuedAt]);
  if (patch.startedAt !== undefined) entries.push(['started_at', patch.startedAt ?? null]);
  if (patch.endedAt !== undefined) entries.push(['ended_at', patch.endedAt ?? null]);
  if (patch.exitCode !== undefined) entries.push(['exit_code', patch.exitCode ?? null]);
  if (patch.output !== undefined) entries.push(['output', patch.output ?? null]);
  if (patch.error !== undefined) entries.push(['error', patch.error ?? null]);
  if (patch.reviewedAt !== undefined) entries.push(['reviewed_at', patch.reviewedAt ?? null]);
  return entries;
}

function taskPatchPostgresEntries(patch: Partial<StackarrTask>): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (patch.commandName !== undefined) entries.push(['command_name', sqlLiteral(patch.commandName)]);
  if (patch.commandLabel !== undefined) entries.push(['command_label', sqlLiteral(patch.commandLabel)]);
  if (patch.status !== undefined) entries.push(['status', sqlLiteral(patch.status)]);
  if (patch.queuedAt !== undefined) entries.push(['queued_at', `${sqlLiteral(patch.queuedAt)}::timestamptz`]);
  if (patch.startedAt !== undefined) entries.push(['started_at', sqlNullableTimestamp(patch.startedAt)]);
  if (patch.endedAt !== undefined) entries.push(['ended_at', sqlNullableTimestamp(patch.endedAt)]);
  if (patch.exitCode !== undefined) entries.push(['exit_code', sqlNullableInteger(patch.exitCode)]);
  if (patch.output !== undefined) entries.push(['output', sqlNullableText(patch.output)]);
  if (patch.error !== undefined) entries.push(['error', sqlNullableText(patch.error)]);
  if (patch.reviewedAt !== undefined) entries.push(['reviewed_at', sqlNullableTimestamp(patch.reviewedAt)]);
  return entries;
}

function agentActivityFromDbRow(row: AgentActivityDbRow): AgentActivityRecord {
  const record: AgentActivityRecord = {
    id: row.id,
    timestamp: row.timestamp,
    caller: row.caller,
    toolName: row.tool_name,
    category: row.category,
    scopes: parseJson(row.scopes, []),
    risk: row.risk,
    status: row.status
  };

  const inputSummary = parseOptionalJson(row.input_summary);
  const resultSummary = parseOptionalJson(row.result_summary);
  if (inputSummary !== undefined) {
    record.inputSummary = inputSummary;
  }
  if (row.duration_ms !== null && row.duration_ms !== undefined) {
    record.durationMs = Number(row.duration_ms);
  }
  if (resultSummary !== undefined) {
    record.resultSummary = resultSummary;
  }
  if (row.error) {
    record.error = row.error;
  }

  return record;
}

function taskFromDbRow(row: TaskDbRow): StackarrTask {
  const task: StackarrTask = {
    id: row.id,
    commandName: row.command_name,
    commandLabel: row.command_label,
    status: row.status,
    queuedAt: row.queued_at
  };

  if (row.started_at) {
    task.startedAt = row.started_at;
  }
  if (row.ended_at) {
    task.endedAt = row.ended_at;
  }
  if (row.exit_code !== null && row.exit_code !== undefined) {
    task.exitCode = Number(row.exit_code);
  }
  if (row.output) {
    task.output = row.output;
  }
  if (row.error) {
    task.error = row.error;
  }
  if (row.reviewed_at) {
    task.reviewedAt = row.reviewed_at;
  }

  return task;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseOptionalJson(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function runPsql(
  sql: string,
  variables: Record<string, string> = {},
  tuplesOnly = true,
  target: StackarrDatabaseTarget = 'main'
) {
  const connection = parsePostgresUrl(target);
  const queryArgs = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    ...(tuplesOnly ? ['-tA'] : []),
    ...Object.entries(variables).flatMap(([key, value]) => ['-v', `${key}=${value}`])
  ];

  const env = {
    ...process.env,
    PGPASSWORD: connection.password,
    PGSSLMODE: connection.sslmode
  };

  return execFileSync(
    'psql',
    ['-h', connection.host, '-p', connection.port, '-U', connection.user, '-d', connection.database, ...queryArgs],
    { encoding: 'utf8', env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

function sqlLiteral(value: unknown) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sqlNullableText(value: unknown) {
  return value === null || value === undefined || value === '' ? 'null' : sqlLiteral(value);
}

function sqlNullableTimestamp(value: unknown) {
  return value === null || value === undefined || value === '' ? 'null' : `${sqlLiteral(value)}::timestamptz`;
}

function sqlNullableInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : 'null';
}

function sqlInteger(value: unknown, fallback: number) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? Math.trunc(number) : fallback;
  return String(Math.max(1, Math.min(1000, normalized)));
}

function sqlJson(value: unknown) {
  return value === undefined ? 'null' : `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function jsonText(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function parsePostgresUrl(target: StackarrDatabaseTarget) {
  const raw = resolvePostgresUrl(target);
  if (!raw) {
    throw new Error(`${target === 'log' ? 'STACKARR_LOG_DATABASE_URL' : 'STACKARR_DATABASE_URL'} is not configured`);
  }

  const url = new URL(raw);
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'stackarr'),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '') || defaultStackarrDatabaseName(target)),
    sslmode: url.searchParams.get('sslmode') || 'disable'
  };
}

function resolvePostgresUrl(target: StackarrDatabaseTarget) {
  const mainUrl = process.env.STACKARR_DATABASE_URL;
  if (target === 'main') {
    return mainUrl;
  }

  if (process.env.STACKARR_LOG_DATABASE_URL) {
    return process.env.STACKARR_LOG_DATABASE_URL;
  }

  if (!mainUrl) {
    return undefined;
  }

  const url = new URL(mainUrl);
  url.pathname = `/${encodeURIComponent(defaultStackarrDatabaseName('log', decodeURIComponent(url.pathname.replace(/^\//, ''))))}`;
  return url.toString();
}

function defaultStackarrDatabaseName(
  target: StackarrDatabaseTarget,
  mainDatabase = process.env.STACKARR_POSTGRES_DATABASE
) {
  if (target === 'main') {
    return mainDatabase || 'stackarr-main';
  }

  if (process.env.STACKARR_POSTGRES_LOG_DATABASE) {
    return process.env.STACKARR_POSTGRES_LOG_DATABASE;
  }

  if (!mainDatabase || mainDatabase === 'stackarr' || mainDatabase === 'stackarr-main') {
    return 'stackarr-log';
  }

  if (mainDatabase.endsWith('-main')) {
    return `${mainDatabase.slice(0, -5)}-log`;
  }

  return `${mainDatabase}-log`;
}
