#!/usr/bin/env node
const { migrateFromSqlite } = require('./stackarr-db.cjs');

const sqlitePath = process.argv[2] || process.env.STACKARR_DATABASE_FILE;

if (!process.env.STACKARR_DATABASE_URL) {
  console.error('STACKARR_DATABASE_URL is required');
  process.exit(2);
}

if (!sqlitePath) {
  console.error('SQLite database path is required');
  process.exit(2);
}

const count = migrateFromSqlite(sqlitePath);
console.log(
  `Migrated ${count.settings} Stackarr setting row(s) and ${count.notifications} notification row(s) to Postgres.`
);
