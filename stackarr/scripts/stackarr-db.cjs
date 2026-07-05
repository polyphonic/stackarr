const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const scriptRoot = path.resolve(__dirname, '..');
const composePath = path.join(scriptRoot, 'docker-compose.yml');

function readSetting(key) {
  if (postgresConfigured()) {
    const postgresValue = withPostgres(() => readPostgresSetting(key));
    if (postgresValue !== undefined) {
      return postgresValue;
    }

    const sqliteValue = readSqliteSetting(key);
    if (sqliteValue !== undefined) {
      withPostgres(() => writePostgresRawSetting(key, sqliteValue));
      return sqliteValue;
    }

    return undefined;
  }

  return readSqliteSetting(key);
}

function writeSettings(patch) {
  if (postgresConfigured()) {
    const currentValue = readSetting('stackarr.runtimeConfig');
    let current = {};
    if (currentValue) {
      try {
        current = JSON.parse(currentValue);
      } catch {
        current = {};
      }
    }
    writePostgresRawSetting('stackarr.runtimeConfig', JSON.stringify({ ...current, ...patch }));
    return 'postgres';
  }

  writeSqliteSettings(patch);
  return 'sqlite';
}

function writeRawSetting(key, value) {
  if (postgresConfigured()) {
    writePostgresRawSetting(key, value);
    return 'postgres';
  }

  writeSqliteRawSetting(key, value);
  return 'sqlite';
}

function upsertTask(task) {
  if (postgresConfigured()) {
    upsertPostgresTask(task);
    pruneTasks();
    return 'postgres';
  }

  upsertSqliteTask(task);
  pruneTasks();
  return 'sqlite';
}

function patchTask(id, patch) {
  if (postgresConfigured()) {
    patchPostgresTask(id, patch);
    pruneTasks();
    return 'postgres';
  }

  patchSqliteTask(id, patch);
  pruneTasks();
  return 'sqlite';
}

function appendTaskOutput(id, output) {
  return patchTask(id, { appendOutput: output });
}

function migrateFromSqlite(sqlitePath) {
  const rows = readSqliteRows(sqlitePath);
  const notifications = readSqliteNotifications(sqlitePath);
  if (!rows.length && !notifications.length) {
    return { settings: 0, notifications: 0 };
  }

  if (!process.env.STACKARR_DATABASE_URL) {
    throw new Error('STACKARR_DATABASE_URL is required');
  }

  ensurePostgresSchema();
  for (const row of rows) {
    writePostgresRawSetting(row.key, row.value);
  }
  for (const notification of notifications) {
    writePostgresNotification(notification);
  }

  return { settings: rows.length, notifications: notifications.length };
}

function readSqliteRows(sqlitePath = process.env.STACKARR_DATABASE_FILE) {
  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    return [];
  }

  const db = new DatabaseSync(sqlitePath);
  try {
    return db.prepare('select key, value from app_settings order by key').all();
  } finally {
    db.close();
  }
}

function readSqliteSetting(key) {
  const dbPath = process.env.STACKARR_DATABASE_FILE;
  if (!dbPath || !fs.existsSync(dbPath)) {
    return undefined;
  }

  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('select value from app_settings where key = ?').get(key);
    return row?.value;
  } finally {
    db.close();
  }
}

function readSqliteNotifications(sqlitePath = process.env.STACKARR_DATABASE_FILE) {
  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    return [];
  }

  const db = new DatabaseSync(sqlitePath);
  try {
    const exists = db
      .prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'notifications'")
      .get();
    if (!exists?.count) {
      return [];
    }

    return db
      .prepare('select id, name, implementation, enabled, url, path, events from notifications order by id')
      .all();
  } finally {
    db.close();
  }
}

function writeSqliteSettings(patch) {
  const dbPath = process.env.STACKARR_DATABASE_FILE;
  if (!dbPath) {
    throw new Error('STACKARR_DATABASE_FILE is required');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table if not exists app_settings (
        key text primary key,
        value text not null,
        updated_at text not null default (datetime('now'))
      );
    `);

    const row = db.prepare('select value from app_settings where key = ?').get('stackarr.runtimeConfig');
    let current = {};
    if (row?.value) {
      try {
        current = JSON.parse(row.value);
      } catch {
        current = {};
      }
    }

    const config = { ...current, ...patch };
    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values (?, ?, datetime('now'))
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run('stackarr.runtimeConfig', JSON.stringify(config));
  } finally {
    db.close();
  }
}

function writeSqliteRawSetting(key, value) {
  const dbPath = process.env.STACKARR_DATABASE_FILE;
  if (!dbPath) {
    throw new Error('STACKARR_DATABASE_FILE is required');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table if not exists app_settings (
        key text primary key,
        value text not null,
        updated_at text not null default (datetime('now'))
      );
    `);

    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values (?, ?, datetime('now'))
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value);
  } finally {
    db.close();
  }
}

function upsertSqliteTask(task) {
  const dbPath = process.env.STACKARR_DATABASE_FILE;
  if (!dbPath) {
    throw new Error('STACKARR_DATABASE_FILE is required');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    ensureSqliteTaskSchema(db);
    db.prepare(`
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
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
        updated_at = excluded.updated_at
    `).run(
      task.id,
      task.commandName,
      task.commandLabel,
      task.status,
      task.queuedAt,
      task.startedAt ?? null,
      task.endedAt ?? null,
      task.exitCode ?? null,
      task.output ?? null,
      task.error ?? null
    );
  } finally {
    db.close();
  }
}

function patchSqliteTask(id, patch) {
  const dbPath = process.env.STACKARR_DATABASE_FILE;
  if (!dbPath) {
    throw new Error('STACKARR_DATABASE_FILE is required');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    ensureSqliteTaskSchema(db);
    const sets = [];
    const values = [];
    const fields = {
      commandName: 'command_name',
      commandLabel: 'command_label',
      status: 'status',
      queuedAt: 'queued_at',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      exitCode: 'exit_code',
      output: 'output',
      error: 'error'
    };

    for (const [key, column] of Object.entries(fields)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${column} = ?`);
        values.push(patch[key] ?? null);
      }
    }

    if (patch.appendOutput !== undefined) {
      sets.push("output = coalesce(output, '') || ?");
      values.push(patch.appendOutput);
    }

    if (sets.length === 0) {
      return;
    }

    sets.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`update tasks set ${sets.join(', ')} where id = ?`).run(...values);
  } finally {
    db.close();
  }
}

function ensureSqliteTaskSchema(db) {
  db.exec(`
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
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists tasks_queued_at_idx on tasks(queued_at);
  `);
}

function pruneSqliteTasks(limit = 100) {
  const dbPath = process.env.STACKARR_DATABASE_FILE;
  if (!dbPath || !fs.existsSync(dbPath)) {
    return;
  }

  const db = new DatabaseSync(dbPath);
  try {
    ensureSqliteTaskSchema(db);
    db.prepare(`
      delete from tasks
      where id not in (
        select id from tasks order by queued_at desc limit ?
      )
    `).run(limit);
  } finally {
    db.close();
  }
}

function readPostgresSetting(key) {
  ensurePostgresSchema();
  return runPsql(`select value from app_settings where key = ${sqlLiteral(key)};`);
}

function writePostgresRawSetting(key, value) {
  runPsql(
    `
      insert into app_settings (key, value, updated_at)
      values (${sqlLiteral(key)}, ${sqlLiteral(value)}, now())
      on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
    `,
    {},
    false
  );
}

function writePostgresNotification(notification) {
  runPsql(
    `
      insert into notifications (id, name, implementation, enabled, url, path, events, updated_at)
      values (
        ${sqlLiteral(notification.id)},
        ${sqlLiteral(notification.name)},
        ${sqlLiteral(notification.implementation)},
        ${notification.enabled ? 'true' : 'false'},
        nullif(${sqlLiteral(notification.url ?? '')}, ''),
        nullif(${sqlLiteral(notification.path ?? '')}, ''),
        ${sqlLiteral(notification.events)},
        now()
      )
      on conflict (id) do update set
        name = excluded.name,
        implementation = excluded.implementation,
        enabled = excluded.enabled,
        url = excluded.url,
        path = excluded.path,
        events = excluded.events,
        updated_at = excluded.updated_at;

      select setval(
        pg_get_serial_sequence('notifications', 'id'),
        greatest((select coalesce(max(id), 1) from notifications), 1),
        true
      );
    `,
    {},
    false
  );
}

function ensurePostgresSchema() {
  runPsql(
    `
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
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists tasks_queued_at_idx on tasks(queued_at);
    `,
    {},
    false
  );
}

function upsertPostgresTask(task) {
  ensurePostgresSchema();
  runPsql(
    `
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
        updated_at
      )
      values (
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
        now()
      )
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
        updated_at = excluded.updated_at;
    `,
    {},
    false
  );
}

function patchPostgresTask(id, patch) {
  ensurePostgresSchema();
  const sets = [];
  const fields = {
    commandName: ['command_name', sqlNullableText],
    commandLabel: ['command_label', sqlNullableText],
    status: ['status', sqlNullableText],
    queuedAt: ['queued_at', sqlNullableTimestamp],
    startedAt: ['started_at', sqlNullableTimestamp],
    endedAt: ['ended_at', sqlNullableTimestamp],
    exitCode: ['exit_code', sqlNullableInteger],
    output: ['output', sqlNullableText],
    error: ['error', sqlNullableText]
  };

  for (const [key, [column, formatter]] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${column} = ${formatter(patch[key])}`);
    }
  }

  if (patch.appendOutput !== undefined) {
    sets.push(`output = coalesce(output, '') || ${sqlLiteral(patch.appendOutput)}`);
  }

  if (sets.length === 0) {
    return;
  }

  sets.push('updated_at = now()');
  runPsql(`update tasks set ${sets.join(', ')} where id = ${sqlLiteral(id)};`, {}, false);
}

function prunePostgresTasks(limit = 100) {
  ensurePostgresSchema();
  runPsql(
    `
      delete from tasks
      where id not in (
        select id from tasks order by queued_at desc limit ${Number.parseInt(String(limit), 10) || 100}
      );
    `,
    {},
    false
  );
}

function pruneTasks() {
  if (postgresConfigured()) {
    prunePostgresTasks();
    return;
  }

  pruneSqliteTasks();
}

function postgresConfigured() {
  return Boolean(process.env.STACKARR_DATABASE_URL);
}

function withPostgres(callback) {
  if (!postgresConfigured()) {
    return undefined;
  }

  try {
    return callback();
  } catch {
    return undefined;
  }
}

function runPsql(sql, variables = {}, tuplesOnly = true) {
  const connection = parsePostgresUrl();
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

  try {
    return execFileSync(
      'psql',
      ['-h', connection.host, '-p', connection.port, '-U', connection.user, '-d', connection.database, ...queryArgs],
      { encoding: 'utf8', env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return execFileSync(
      'docker',
      [
        'compose',
        '-f',
        composePath,
        'exec',
        '-T',
        '-e',
        `PGPASSWORD=${connection.password}`,
        '-e',
        `PGSSLMODE=${connection.sslmode}`,
        'database',
        'psql',
        '-h',
        '127.0.0.1',
        '-p',
        '5432',
        '-U',
        connection.user,
        '-d',
        connection.database,
        ...queryArgs
      ],
      { encoding: 'utf8', env: dockerEnv(), input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  }
}

function dockerEnv() {
  const env = { ...process.env };
  const requestedContext = env.STACKARR_DOCKER_CONTEXT || env.DOCKER_CONTEXT;
  if (requestedContext) {
    env.DOCKER_CONTEXT = requestedContext;
    delete env.DOCKER_HOST;
    return env;
  }

  if ((env.DOCKER_HOST || '').includes('arcbox')) {
    env.DOCKER_CONTEXT = 'orbstack';
    delete env.DOCKER_HOST;
    return env;
  }

  try {
    const currentContext = execFileSync('docker', ['context', 'show'], { encoding: 'utf8', env }).trim();
    if (currentContext.includes('arcbox')) {
      execFileSync('docker', ['context', 'inspect', 'orbstack'], { encoding: 'utf8', env, stdio: 'ignore' });
      env.DOCKER_CONTEXT = 'orbstack';
      delete env.DOCKER_HOST;
    }
  } catch {
    // Leave the caller's Docker environment untouched if context probing is unavailable.
  }

  return env;
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sqlNullableText(value) {
  return value === null || value === undefined ? 'null' : sqlLiteral(value);
}

function sqlNullableTimestamp(value) {
  return value === null || value === undefined ? 'null' : `${sqlLiteral(value)}::timestamptz`;
}

function sqlNullableInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : 'null';
}

function parsePostgresUrl() {
  const raw = process.env.STACKARR_DATABASE_URL;
  if (!raw) {
    throw new Error('STACKARR_DATABASE_URL is not configured');
  }

  const url = new URL(raw);
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'stackarr'),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'stackarr-main'),
    sslmode: url.searchParams.get('sslmode') || 'disable'
  };
}

module.exports = {
  appendTaskOutput,
  migrateFromSqlite,
  patchTask,
  readSetting,
  readSqliteRows,
  upsertTask,
  writeRawSetting,
  writeSettings
};
