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
  // Missing fields inherit the caller's configured values/defaults. An unrelated
  // saved UI preference must not reset an explicit browser-link override.
  if (['localhost', 'loopback', 'portless'].includes(ui.serviceUrlMode)) {
    console.log('export STACKARR_SERVICE_URL_MODE=' + quote(ui.serviceUrlMode));
  }
  if (['http', 'https'].includes(ui.serviceUrlScheme)) {
    console.log('export STACKARR_SERVICE_URL_SCHEME=' + quote(ui.serviceUrlScheme));
  }
  if (typeof ui.serviceUrlHostSuffix === 'string' && ui.serviceUrlHostSuffix.trim()) {
    console.log('export STACKARR_SERVICE_URL_HOST_SUFFIX=' + quote(normalizeHostSuffix(ui.serviceUrlHostSuffix)));
  }
  if (typeof ui.unifyServiceUrls === 'boolean') {
    console.log('export STACKARR_UNIFY_SERVICE_URLS=' + quote(String(ui.unifyServiceUrls)));
  }
} catch {
  // Keep values already loaded from the generated Compose environment when the
  // host cannot connect to a container-only PostgreSQL hostname. Callers set
  // portable defaults before invoking this exporter.
  process.exit(0);
}
