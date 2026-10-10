#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const script = path.join(__dirname, 'homeassistant-configure.cjs');

function server(state) {
  const sockets = new Set();
  const app = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/api/')
      return send(
        req.headers.authorization === `Bearer ${state.token}` ||
          (!state.rejectMinted && req.headers.authorization === 'Bearer minted-secret')
          ? 200
          : 401,
        { message: 'API running.' }
      );
    if (req.url === '/auth/providers')
      return state.mfa ? send(200, { providers: [] }) : send(200, { providers: [{ type: 'homeassistant', id: null }] });
    if (req.url === '/auth/login_flow') return send(200, { type: 'form', step_id: 'init', flow_id: 'flow' });
    if (req.url === '/auth/login_flow/flow') {
      const data = JSON.parse(body);
      assert.equal(data.client_id, 'http://localhost/');
      return send(200, state.mfa ? { type: 'form', step_id: 'mfa' } : { type: 'create_entry', result: 'code' });
    }
    if (req.url === '/auth/token')
      return send(200, { access_token: 'transient-secret', refresh_token: 'refresh-secret' });
    if (req.url === '/auth/revoke') {
      state.revoked++;
      return send(200, {});
    }
    return send(404, {});
  });
  app.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const key = req.headers['sec-websocket-key'];
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        crypto
          .createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64') +
        '\r\n\r\n'
    );
    const send = (obj) => {
      const data = Buffer.from(JSON.stringify(obj));
      socket.write(
        Buffer.concat([
          data.length < 126
            ? Buffer.from([0x81, data.length])
            : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]),
          data
        ])
      );
    };
    send({ type: 'auth_required' });
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 6) {
        let size = buffered[1] & 127;
        let offset = 2;
        if (size === 126) {
          if (buffered.length < 8) return;
          size = buffered.readUInt16BE(2);
          offset = 4;
        }
        if (buffered.length < offset + 4 + size) return;
        const opcode = buffered[0] & 15;
        const mask = buffered.subarray(offset, offset + 4);
        const bytes = buffered.subarray(offset + 4, offset + 4 + size);
        buffered = buffered.subarray(offset + 4 + size);
        if (opcode === 8) {
          socket.end(Buffer.from([0x88, 0x00]));
          return;
        }
        let msg;
        try {
          msg = JSON.parse(Buffer.from(bytes.map((b, i) => b ^ mask[i % 4])).toString());
        } catch {
          continue;
        }
        if (msg.type === 'auth') {
          send({ type: 'auth_ok' });
          continue;
        }
        let result;
        if (msg.type === 'auth/refresh_tokens')
          result = state.minted
            ? [{ id: 'minted-id', client_name: 'Stackarr health', type: 'long_lived_access_token' }]
            : [];
        else if (msg.type === 'auth/long_lived_access_token') {
          state.minted++;
          result = 'minted-secret';
        } else if (msg.type === 'auth/delete_refresh_token') {
          state.deleted++;
          result = {};
        } else throw Error('unexpected command');
        send({ id: msg.id, type: 'result', success: true, result });
      }
    });
  });
  app.destroySockets = () => {
    for (const socket of sockets) socket.destroy();
  };
  return app;
}

// Child process lets the fake server handle concurrent HTTP and WS exchanges.
async function fixture(initial, mfa = false) {
  const state = {
    token: initial === 'already-valid' ? initial : 'different-valid-token',
    minted: 0,
    deleted: 0,
    revoked: 0,
    mfa
  };
  const app = server(state);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-ha-test-'));
  const dbPath = path.join(dir, 'runtime.db');
  const db = new DatabaseSync(dbPath);
  db.exec('create table app_settings (key text primary key, value text not null, updated_at text)');
  db.prepare('insert into app_settings (key, value) values (?, ?)').run(
    'stackarr.runtimeConfig',
    JSON.stringify(initial ? { HOMEASSISTANT_TOKEN: initial } : {})
  );
  db.close();
  return {
    state,
    dbPath,
    url: `http://127.0.0.1:${app.address().port}`,
    read() {
      const db = new DatabaseSync(dbPath);
      const value = JSON.parse(
        db.prepare("select value from app_settings where key='stackarr.runtimeConfig'").get().value
      );
      db.close();
      return value;
    },
    async close() {
      app.destroySockets();
      app.closeAllConnections();
      await new Promise((resolve) => app.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function run(fx, overrides = {}) {
  // spawn asynchronously: spawnSync would block the in-process fake server.
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      STACKARR_DATABASE_FILE: fx.dbPath,
      STACKARR_DATABASE_URL: '',
      HOMEASSISTANT_URL: fx.url,
      USERNAME: 'private-user',
      PASSWORD: 'private-pass',
      HOMEASSISTANT_TOKEN: '',
      ...overrides
    }
  });
  const chunks = [];
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));
  const timeout = setTimeout(() => child.kill(), 12000);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timeout);
  const output = Buffer.concat(chunks).toString();
  for (const secret of ['private-user', 'private-pass', 'minted-secret', 'transient-secret', 'refresh-secret'])
    assert.equal(output.includes(secret), false);
  return { code, output };
}

test('reuses valid persisted token without minting', async () => {
  const fx = await fixture('already-valid');
  try {
    const result = await run(fx);
    assert.equal(result.code, 0);
    assert.equal(fx.state.minted, 0);
    assert.equal(fx.read().HOMEASSISTANT_TOKEN, 'already-valid');
  } finally {
    await fx.close();
  }
});
test('mints, validates, persists, reads back and revokes transient session', async () => {
  const fx = await fixture('stale');
  try {
    const result = await run(fx);
    assert.equal(result.code, 0, `${result.output} state=${JSON.stringify(fx.state)}`);
    assert.equal(fx.state.minted, 1);
    assert.equal(fx.state.revoked, 1);
    assert.equal(fx.read().HOMEASSISTANT_TOKEN, 'minted-secret');
  } finally {
    await fx.close();
  }
});
test('manual/onboarding gate does not overwrite state', async () => {
  const fx = await fixture('stale', true);
  try {
    const result = await run(fx);
    assert.notEqual(result.code, 0);
    assert.equal(fx.state.minted, 0);
    assert.equal(fx.read().HOMEASSISTANT_TOKEN, 'stale');
  } finally {
    await fx.close();
  }
});
test('failed minted-token validation revokes only the new token', async () => {
  const fx = await fixture('stale');
  fx.state.rejectMinted = true;
  try {
    const result = await run(fx);
    assert.notEqual(result.code, 0);
    assert.equal(fx.state.minted, 1);
    assert.equal(fx.state.deleted, 1);
    assert.equal(fx.state.revoked, 1);
    assert.equal(fx.read().HOMEASSISTANT_TOKEN, 'stale');
  } finally {
    await fx.close();
  }
});
