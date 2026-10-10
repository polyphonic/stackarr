#!/usr/bin/env node
'use strict';

// Provision a user-scoped Home Assistant long-lived token for Stackarr health.
// Uses only the configured shared login; never reads or changes HA credential files.
// HA auth API: https://developers.home-assistant.io/docs/auth_api/
const { readSetting, writeSettings } = require('./stackarr-db.cjs');

const CLIENT = 'http://localhost/';
const NAME = 'Stackarr health';
const TIMEOUT = 8000;
const fail = (message) => {
  throw new Error(message);
};
const isString = (value) => typeof value === 'string' && value.length > 0;

function baseUrl(raw) {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    fail('HOMEASSISTANT_URL must be an HTTP(S) origin without credentials or path');
  }
  return url;
}

async function request(url, path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, url), {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch {
    fail('Home Assistant request could not connect or timed out');
  }
  if (response.status >= 300 && response.status < 400) fail('Home Assistant redirected an authentication request');
  return response;
}

async function json(url, path, options = {}) {
  const response = await request(url, path, options);
  if (!response.ok) fail(`Home Assistant ${path} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    fail(`Home Assistant ${path} returned invalid JSON`);
  }
}

async function validToken(url, token) {
  const response = await request(url, '/api/', { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200) return false;
  try {
    return (await response.json())?.message === 'API running.';
  } catch {
    return false;
  }
}

function socket(url, accessToken) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL('/api/websocket', url);
    endpoint.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(endpoint);
    let nextId = 1;
    const pending = new Map();
    let ready = false;
    const timer = setTimeout(() => close(new Error('Home Assistant WebSocket timed out')), TIMEOUT);
    function close(error) {
      clearTimeout(timer);
      for (const [, waiter] of pending) waiter.reject(error);
      pending.clear();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      if (!ready) reject(error);
    }
    ws.addEventListener('error', () => close(new Error('Home Assistant WebSocket connection failed')));
    ws.addEventListener('close', () => close(new Error('Home Assistant WebSocket closed')));
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return close(new Error('Home Assistant WebSocket returned invalid JSON'));
      }
      if (message.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
      else if (message.type === 'auth_invalid') close(new Error('Home Assistant WebSocket rejected authentication'));
      else if (message.type === 'auth_ok') {
        ready = true;
        clearTimeout(timer);
        resolve({
          send(type, fields = {}) {
            return new Promise((accept, deny) => {
              const id = nextId++;
              const timeout = setTimeout(() => {
                pending.delete(id);
                deny(new Error('Home Assistant WebSocket command timed out'));
              }, TIMEOUT);
              pending.set(id, {
                resolve: (value) => {
                  clearTimeout(timeout);
                  accept(value);
                },
                reject: (error) => {
                  clearTimeout(timeout);
                  deny(error);
                }
              });
              ws.send(JSON.stringify({ id, type, ...fields }));
            });
          },
          close: () => ws.close()
        });
      } else if (message.type === 'result' && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.success) waiter.resolve(message.result);
        else waiter.reject(new Error('Home Assistant WebSocket command was refused'));
      }
    });
  });
}

async function login(url, username, password) {
  const providers = await json(url, '/auth/providers');
  if (
    !Array.isArray(providers.providers) ||
    !providers.providers.some((provider) => provider.type === 'homeassistant' && provider.id == null)
  ) {
    fail('Home Assistant local password provider is unavailable; finish onboarding or configure a token manually');
  }
  const start = await json(url, '/auth/login_flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT, redirect_uri: CLIENT, handler: ['homeassistant', null] })
  });
  if (start.type !== 'form' || start.step_id !== 'init' || !isString(start.flow_id)) {
    fail('Home Assistant login requires an unsupported onboarding or authentication step');
  }
  const step = await json(url, `/auth/login_flow/${encodeURIComponent(start.flow_id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT, username, password })
  });
  if (step.type !== 'create_entry' || !isString(step.result)) {
    fail('Home Assistant password login did not complete; check credentials, MFA or onboarding');
  }
  const tokens = await json(url, '/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: step.result, client_id: CLIENT })
  });
  if (!isString(tokens.access_token) || !isString(tokens.refresh_token))
    fail('Home Assistant token exchange was incomplete');
  return tokens;
}

async function revoke(url, refreshToken) {
  const response = await request(url, '/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken })
  });
  if (!response.ok) fail('Home Assistant temporary session revocation failed');
}

async function provision(env = process.env) {
  if (!env.STACKARR_DATABASE_URL && !env.STACKARR_DATABASE_FILE)
    fail('Authoritative Stackarr runtime database is not configured');
  const url = baseUrl(env.HOMEASSISTANT_URL || 'http://127.0.0.1:8123');
  const stored = readSetting('stackarr.runtimeConfig');
  if (!stored) fail('Stackarr runtime configuration is not initialized');
  let config;
  try {
    config = JSON.parse(stored);
  } catch {
    fail('Stackarr runtime configuration is invalid');
  }
  const existing = config.HOMEASSISTANT_TOKEN || env.HOMEASSISTANT_TOKEN || '';
  if (existing && (await validToken(url, existing))) return 'reused';
  if (!env.USERNAME || !env.PASSWORD)
    fail('Home Assistant health token requires configured shared USERNAME and PASSWORD or a manual token');

  let transient,
    transientRevoked = false,
    ws,
    minted,
    mintedId;
  try {
    transient = await login(url, env.USERNAME, env.PASSWORD);
    ws = await socket(url, transient.access_token);
    const before = await ws.send('auth/refresh_tokens');
    if (!Array.isArray(before)) fail('Home Assistant token inventory was unavailable');
    const previousIds = new Set(before.map((item) => item.id));
    minted = await ws.send('auth/long_lived_access_token', { client_name: NAME, lifespan: 3650 });
    if (!isString(minted)) fail('Home Assistant did not create a long-lived token');
    // Identify only the token this run added; never revoke another user's token.
    const after = await ws.send('auth/refresh_tokens');
    const created = Array.isArray(after)
      ? after.filter(
          (item) => !previousIds.has(item.id) && item.client_name === NAME && item.type === 'long_lived_access_token'
        )
      : [];
    if (created.length === 1) mintedId = created[0].id;
    if (!(await validToken(url, minted))) fail('New Home Assistant token failed API authentication');
    if (!mintedId) fail('New Home Assistant token could not be identified for safe rollback');
    writeSettings({ HOMEASSISTANT_TOKEN: minted });
    const saved = JSON.parse(readSetting('stackarr.runtimeConfig') || '{}');
    if (saved.HOMEASSISTANT_TOKEN !== minted) fail('Home Assistant token persistence readback failed');
    await revoke(url, transient.refresh_token);
    transientRevoked = true;
    return 'created';
  } catch (error) {
    if (minted) {
      // On a partial write, restore only the prior setting; never remove other config.
      try {
        const current = JSON.parse(readSetting('stackarr.runtimeConfig') || '{}');
        if (current.HOMEASSISTANT_TOKEN === minted)
          writeSettings({ HOMEASSISTANT_TOKEN: config.HOMEASSISTANT_TOKEN || '' });
      } catch {
        /* reported via failure below */
      }
      let rollbackSocket;
      try {
        if (!mintedId) {
          // Authenticate as the just-created token, not another user's session.
          rollbackSocket = await socket(url, minted);
          const inventory = await rollbackSocket.send('auth/refresh_tokens');
          const current = Array.isArray(inventory)
            ? inventory.filter(
                (item) => item.is_current && item.client_name === NAME && item.type === 'long_lived_access_token'
              )
            : [];
          if (current.length === 1) mintedId = current[0].id;
        }
        if (!mintedId)
          fail('Home Assistant token provisioning failed; the minted token could not be identified for revocation');
        await (rollbackSocket || ws).send('auth/delete_refresh_token', { refresh_token_id: mintedId });
      } catch {
        fail('Home Assistant token provisioning failed and minted token revocation could not be confirmed');
      } finally {
        rollbackSocket?.close();
      }
    }
    throw error;
  } finally {
    ws?.close();
    if (transient?.refresh_token && !transientRevoked) await revoke(url, transient.refresh_token);
  }
}

if (require.main === module) {
  provision()
    .then((result) => console.log(`Home Assistant health token ${result}`))
    .catch((error) => {
      // Never print remote bodies, token values, usernames, URLs, or exception causes.
      const safe =
        error instanceof Error && /^(Home Assistant|Stackarr|Authoritative)/.test(error.message)
          ? error.message
          : 'Home Assistant health token provisioning failed';
      console.error(safe);
      process.exitCode = 1;
    });
}
module.exports = { provision };
