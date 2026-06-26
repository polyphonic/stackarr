const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const scriptRoot = path.resolve(__dirname, '..');
const composePath = path.join(scriptRoot, 'docker-compose.yml');

function readSetting(key) {
  const postgresValue = withPostgres(() => readPostgresSetting(key));
  if (postgresValue !== undefined) {
    if (key === 'stackarr.runtimeConfig') {
      const sqliteValue = readSqliteSetting(key);
      if (sqliteValue !== undefined && sqliteValue !== postgresValue) {
        withPostgres(() => writePostgresRawSetting(key, sqliteValue));
        return sqliteValue;
      }
    }
    return postgresValue;
  }

  return readSqliteSetting(key);
}

function writeSettings(patch) {
  const wrotePostgres = Boolean(withPostgres(() => writePostgresSettings(patch)));
  writeSqliteSettings(patch);

  if (wrotePostgres) {
    return 'postgres+sqlite';
  }

  return 'sqlite';
}

function writeRawSetting(key, value) {
  const wrotePostgres = Boolean(withPostgres(() => writePostgresRawSetting(key, value)));
  writeSqliteRawSetting(key, value);

  if (wrotePostgres) {
    return 'postgres+sqlite';
  }

  return 'sqlite';
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

function readPostgresSetting(key) {
  ensurePostgresSchema();
  return runPsql(`select value from app_settings where key = ${sqlLiteral(key)};`);
}

function writePostgresSettings(patch) {
  ensurePostgresSchema();
  const current = JSON.parse(readPostgresSetting('stackarr.runtimeConfig') || '{}');
  writePostgresRawSetting('stackarr.runtimeConfig', JSON.stringify({ ...current, ...patch }));
  return true;
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
    `,
    {},
    false
  );
}

function withPostgres(callback) {
  if (!process.env.STACKARR_DATABASE_URL) {
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
      { encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
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
  migrateFromSqlite,
  readSetting,
  readSqliteRows,
  writeRawSetting,
  writeSettings
};
