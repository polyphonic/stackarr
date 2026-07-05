#!/usr/bin/env node
const { readSetting } = require('./stackarr-db.cjs');

const dbPath = process.env.STACKARR_DATABASE_FILE;

function quote(value) {
  return "'" + String(value ?? '').replace(/'/g, "'\\''") + "'";
}

function normalizeHostSuffix(value) {
  return (
    String(value || 'stackarr')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^\.+|\.+$/g, '') || 'stackarr'
  );
}

try {
  if (!dbPath) throw new Error('STACKARR_DATABASE_FILE is required');
  const value = readSetting('stackarr.settings');
  const settings = value ? JSON.parse(value) : {};
  const ui = settings.ui && typeof settings.ui === 'object' ? settings.ui : {};
  const mode = ['localhost', 'loopback', 'portless'].includes(ui.serviceUrlMode) ? ui.serviceUrlMode : 'localhost';
  const scheme = ui.serviceUrlScheme === 'http' ? 'http' : 'https';
  const suffix = normalizeHostSuffix(ui.serviceUrlHostSuffix);
  const unify = ui.unifyServiceUrls === false ? 'false' : 'true';

  console.log('export STACKARR_SERVICE_URL_MODE=' + quote(mode));
  console.log('export STACKARR_SERVICE_URL_SCHEME=' + quote(scheme));
  console.log('export STACKARR_SERVICE_URL_HOST_SUFFIX=' + quote(suffix));
  console.log('export STACKARR_UNIFY_SERVICE_URLS=' + quote(unify));
} catch {
  console.log("export STACKARR_SERVICE_URL_MODE='localhost'");
  console.log("export STACKARR_SERVICE_URL_SCHEME='https'");
  console.log("export STACKARR_SERVICE_URL_HOST_SUFFIX='stackarr'");
  console.log("export STACKARR_UNIFY_SERVICE_URLS='true'");
}
