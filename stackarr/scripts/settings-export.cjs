#!/usr/bin/env node
const { readSetting } = require('./stackarr-db.cjs');

const dbPath = process.env.STACKARR_DATABASE_FILE;

function quote(value) {
  return "'" + String(value ?? '').replace(/'/g, "'\\''") + "'";
}

function normalizeHostSuffix(value) {
  return (
    String(value || 'stack')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^\.+|\.+$/g, '') || 'stack'
  );
}

try {
  if (!dbPath) throw new Error('STACKARR_DATABASE_FILE is required');
  const value = readSetting('stackarr.settings');
  if (!value) process.exit(0);
  const settings = JSON.parse(value);
  const ui = settings.ui && typeof settings.ui === 'object' ? settings.ui : {};
  const mode = ['localhost', 'loopback', 'portless'].includes(ui.serviceUrlMode) ? ui.serviceUrlMode : 'localhost';
  const scheme = ui.serviceUrlScheme === 'http' ? 'http' : 'https';
  const suffix = normalizeHostSuffix(ui.serviceUrlHostSuffix);
  const unify = ui.unifyServiceUrls === true ? 'true' : 'false';

  console.log('export STACKARR_SERVICE_URL_MODE=' + quote(mode));
  console.log('export STACKARR_SERVICE_URL_SCHEME=' + quote(scheme));
  console.log('export STACKARR_SERVICE_URL_HOST_SUFFIX=' + quote(suffix));
  console.log('export STACKARR_UNIFY_SERVICE_URLS=' + quote(unify));
} catch {
  // Keep values already loaded from the generated Compose environment when the
  // host cannot connect to a container-only PostgreSQL hostname. Callers set
  // portable defaults before invoking this exporter.
  process.exit(0);
}
