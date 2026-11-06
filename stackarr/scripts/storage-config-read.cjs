#!/usr/bin/env node
// This small reader may run on the native host or over stdin in the managed
// controller. It never initializes schemas, writes settings or imports defaults.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Only the explicit discovery invocation inside the controller may borrow the
// already mounted native Plex preferences. The ordinary reader stays raw.
function enrichForCapacity(config) {
  if (process.argv.slice(2).join('') !== '--capacity-discovery' || process.argv.length !== 3 ||
      process.platform !== 'linux' || !(fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) ||
      config.PLEX_INSTALL_MODE !== 'native' || config.PLEX_TOKEN ||
      typeof config.PLEX_PREFS_PATH !== 'string') return;
  const file = config.PLEX_PREFS_PATH;
  if (!path.isAbsolute(file) || file.length > 4096 || /[\r\n\0]/.test(file) ||
      file.split('/').includes('..') || file.split('/').includes('.')) return;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) return;
    const token = execFileSync('python3', ['-c', `import plistlib, sys\nwith open(sys.argv[1], 'rb') as f:\n    data = f.read(1048577)\nif len(data) > 1048576:\n    sys.exit(0)\nvalue = plistlib.loads(data).get('PlexOnlineToken')\nif isinstance(value, str) and 0 < len(value) <= 4096 and '\\r' not in value and '\\n' not in value:\n    sys.stdout.write(value)`, file], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'ignore']
    });
    if (token && token.length <= 4096 && !/[\r\n\0]/.test(token)) config.PLEX_TOKEN = token;
  } catch { /* Missing or unreadable preference is authentication-unavailable. */ }
}
try {
  if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== '--capacity-discovery'))
    throw new Error('Invalid reader option');
  let value;
  if (process.env.STACKARR_DATABASE_URL) {
    const url = new URL(process.env.STACKARR_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database');
    value = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', url.hostname,
      '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', decodeURIComponent(url.pathname.slice(1)),
      '-c', "select value from app_settings where key = 'stackarr.runtimeConfig'"], {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '2',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=2000',
        ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}) },
      encoding: 'utf8', timeout: 3000, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } else {
    if (process.env.STACKARR_DATABASE_MODE === 'postgres') throw new Error('Postgres unavailable');
    const file = process.env.STACKARR_DATABASE_FILE;
    if (!file || !fs.existsSync(file)) throw new Error('Database absent');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try { value = db.prepare('select value from app_settings where key = ?').get('stackarr.runtimeConfig')?.value; }
    finally { db.close(); }
  }
  const config = JSON.parse(value);
  if (!config || Array.isArray(config) || typeof config !== 'object' || Object.values(config).some(v => typeof v !== 'string'))
    throw new Error('Invalid runtime record');
  enrichForCapacity(config);
  process.stdout.write(JSON.stringify(config));
} catch { process.stderr.write('authoritative-storage-config-unavailable\n'); process.exitCode = 1; }
