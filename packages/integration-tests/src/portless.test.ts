import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// Test the public host CLI boundary. The fixture models the documented upstream
// CLI, including its dangerous silent replacement of existing static aliases.
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-portless-'));
  mkdirSync(path.join(dir, 'bin'));
  const state = path.join(dir, 'fixture.json');
  writeFileSync(
    state,
    JSON.stringify({ installed: true, responding: true, tld: 'stack', tls: true, port: 443, routes: [] })
  );
  writeFileSync(
    path.join(dir, 'bin/portless'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.FIXTURE;
const s = JSON.parse(fs.readFileSync(file));
const a = process.argv.slice(2);
fs.appendFileSync(file + '.calls', a.join(' ') + '\\n');
if (a[0] === '--version') console.log(s.version || '0.15.11');
else if (a[0] === 'service' && a[1] === 'status') console.log('portless service\\n  Manager state: ' + (s.installed ? 'running' : 'not installed') + '\\n  Installed: ' + (s.installed ? 'yes' : 'no') + '\\n  Proxy on ' + s.port + ': ' + (s.responding ? 'responding' : 'not responding') + '\\n  HTTPS: ' + (s.tls ? 'yes' : 'no') + '\\n  TLDs: .' + s.tld + '\\n  LAN mode: no\\n  State directory: ' + process.env.PORTLESS_STATE_DIR);
else if (a[0] === 'service' && a[1] === 'install') { if(s.installFail) process.exit(1); s.installed = true; s.responding = true; s.tld = a[a.indexOf('--tld')+1]; s.tls = !a.includes('--no-tls'); s.port = Number(a[a.indexOf('-p')+1]); }
else if (a[0] === 'list') {
 if(s.malformed) console.log('unexpected inventory');
 else if (!s.routes.length) console.log('No active routes.\\nStart an app with: portless <name> <command>');
 else { console.log('Active routes:'); for(const r of s.routes) console.log('  ' + (s.tls ? 'https' : 'http') + '://' + r.name + (s.port === (s.tls ? 443 : 80) ? '' : ':' + s.port) + '  ->  localhost:' + r.port + '  (' + (r.pid ? 'pid ' + r.pid : 'alias') + ')'); }
} else if (a[0] === 'doctor') console.log('Mode: ' + (s.tls ? 'HTTPS' : 'HTTP') + ', .' + (s.activeTld || s.tld) + '\\nProxy target: ' + (s.tls ? 'https' : 'http') + '://127.0.0.1' + (s.port === (s.tls ? 443 : 80) ? '' : ':' + s.port));
else if (a[0] === 'alias') {
 const name = a[a[1] === '--remove' ? 2 : 1] + '.' + s.tld;
 s.routes = s.routes.filter(r => r.name !== name);
 if(a[1] !== '--remove') s.routes.push({name, port:Number(a[2]), pid:0});
} else if (a[0] === 'hosts' && a[1] === 'sync') { if(s.hostsFail) process.exit(1); }
else process.exit(9);
fs.writeFileSync(file, JSON.stringify(s));
`,
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    PATH: `${dir}/bin:${process.env.PATH}`,
    FIXTURE: state,
    STATE_ROOT: dir,
    PORTLESS_STATE_DIR: dir,
    STACKARR_SERVICE_URL_HOST_SUFFIX: 'stack',
    STACKARR_SERVICE_URL_SCHEME: 'https'
  };
  writeFileSync(
    path.join(dir, 'bin/curl'),
    '#!/usr/bin/env node\nconst fs=require("node:fs");const s=JSON.parse(fs.readFileSync(process.env.FIXTURE));fs.appendFileSync(process.env.FIXTURE+".curl-calls",JSON.stringify(process.argv.slice(2))+"\\n");process.stdout.write(s.httpCode || "200");',
    { mode: 0o755 }
  );
  return {
    dir,
    read: () => JSON.parse(readFileSync(state, 'utf8')),
    set: (patch: object) =>
      writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), ...patch })),
    calls: () => readFileSync(`${state}.calls`, 'utf8'),
    curlCalls: () => (existsSync(`${state}.curl-calls`) ? readFileSync(`${state}.curl-calls`, 'utf8') : ''),
    run: (command = 'apply', input = 'app\t7777\n', extra = {}) =>
      execFileSync(process.execPath, [path.join(root, 'stackarr/scripts/portless-routes.cjs'), command], {
        env: { ...env, ...extra },
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }),
    shell: (extra = {}) =>
      execFileSync('bash', [path.join(root, 'stackarr/scripts/portless.sh'), 'apply'], {
        env: {
          ...env,
          HOME: dir,
          APP_ROOT: dir,
          CONFIG_ROOT: path.join(dir, 'config'),
          LOG_ROOT: path.join(dir, 'logs'),
          STACKARR_DATABASE_MODE: 'sqlite',
          STACKARR_DATABASE_URL: '',
          STACKARR_DATABASE_FILE: path.join(dir, 'missing.db'),
          STACKARR_COMPOSE_ENV_FILE: path.join(dir, 'missing.env'),
          STACKARR_STORAGE_POLICY_FILE: path.join(dir, 'missing-policy.json'),
          ...extra
        },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('partial UI settings preserve inherited preferences and explicit saved localhost/HTTP/suffix values survive export', () => {
  const f = fixture();
  const file = path.join(f.dir, 'settings.db');
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const save = (ui: object) =>
      db.prepare('INSERT OR REPLACE INTO app_settings VALUES (?, ?)').run('stackarr.settings', JSON.stringify({ ui }));
    const read = () =>
      execFileSync(process.execPath, [path.join(root, 'stackarr/scripts/settings-export.cjs')], {
        env: {
          ...process.env,
          STACKARR_DATABASE_URL: '',
          STACKARR_DATABASE_MODE: 'sqlite',
          STACKARR_DATABASE_FILE: file
        },
        encoding: 'utf8'
      });
    save({ theme: 'dark' });
    assert.equal(read(), '');
    save({
      serviceUrlMode: 'localhost',
      serviceUrlScheme: 'http',
      serviceUrlHostSuffix: 'custom.test',
      unifyServiceUrls: false
    });
    assert.equal(
      read(),
      "export STACKARR_SERVICE_URL_MODE='localhost'\nexport STACKARR_SERVICE_URL_SCHEME='http'\nexport STACKARR_SERVICE_URL_HOST_SUFFIX='custom.test'\nexport STACKARR_UNIFY_SERVICE_URLS='false'\n"
    );
  } finally {
    db.close();
    f.cleanup();
  }
});

test('Portless host CLI maps configured ports, optional services and native Plex without Docker naming changes', () => {
  const f = fixture();
  try {
    f.shell({
      STACKARR_WEB_ENABLED: 'true',
      STACKARR_WEB_PORT: '9001',
      PREFERRED_TORRENT_CLIENT: 'qbittorrent',
      QBITTORRENT_WEBUI_PORT: '9002',
      PLEX_INSTALL_MODE: 'native',
      PLEX_DOCKER_PORT: '9003',
      ENABLE_4K_SERVARR: 'false',
      ENABLE_TDARR: 'true',
      TDARR_WEB_PORT: '9004',
      ENABLE_HOMEASSISTANT: 'true',
      HOMEASSISTANT_PORT: '9005'
    });
    const routes = Object.fromEntries(f.read().routes.map((v: { name: string; port: number }) => [v.name, v.port]));
    assert.equal(routes['app.stack'], 9001);
    assert.equal(routes['qbittorrent.stack'], 9002);
    assert.equal(routes['plex.stack'], 32400);
    assert.equal(routes['tdarr.stack'], 9004);
    assert.equal(routes['home.stack'], 9005);
    assert.equal(routes['prowlarr.stack'], 9696);
    for (const missing of ['stackarr.stack', 'radarr4k.stack', 'sonarr4k.stack', 'transmission.stack'])
      assert.equal(routes[missing], undefined);
    assert.doesNotMatch(f.calls(), /proxy|--force/);
  } finally {
    f.cleanup();
  }
});

test('Portless removes only ledger-owned stale aliases and preserves pre-existing matches', () => {
  const f = fixture();
  try {
    f.set({ routes: [{ name: 'plex.stack', port: 32400, pid: 0 }] });
    f.run('apply', 'app\t7777\nplex\t32400\n');
    f.run('apply', 'plex\t32400\n');
    assert.deepEqual(f.read().routes, [{ name: 'plex.stack', port: 32400, pid: 0 }]);
    f.run('uninstall', '');
    assert.deepEqual(f.read().routes, [{ name: 'plex.stack', port: 32400, pid: 0 }]);
    assert.match(f.calls(), /alias --remove app/);
    assert.doesNotMatch(f.calls(), /alias --remove plex|service uninstall/);
  } finally {
    f.cleanup();
  }
});

test('Portless preserves changed ownership, while an owned origin-port edit reconciles safely', () => {
  const f = fixture();
  try {
    f.run();
    f.run('apply', 'app\t7778\n');
    assert.equal(f.read().routes[0].port, 7778);
    f.set({ routes: [{ name: 'app.stack', port: 9999, pid: 321 }] });
    f.run('uninstall', '');
    assert.deepEqual(f.read().routes, [{ name: 'app.stack', port: 9999, pid: 321 }]);
    assert.doesNotMatch(f.calls(), /alias --remove/);
  } finally {
    f.cleanup();
  }
});

for (const patch of [
  { routes: [{ name: 'app.stack', port: 9999, pid: 0 }] },
  { routes: [{ name: 'app.stack', port: 7777, pid: 123 }] },
  { tld: 'other' },
  { tld: 'stack, .other' },
  { activeTld: 'stack, .other' },
  { tls: false },
  { port: 1355 },
  { responding: false },
  { malformed: true },
  { version: '0.15.10' }
]) {
  test(`Portless rejects incompatible or ambiguous shared state without mutation: ${JSON.stringify(patch)}`, () => {
    const f = fixture();
    try {
      f.set(patch);
      const before = f.read();
      assert.throws(() => f.run());
      assert.deepEqual(f.read(), before);
      assert.doesNotMatch(f.calls(), /alias |hosts sync|proxy |service install/);
    } finally {
      f.cleanup();
    }
  });
}

test('Portless first install uses upstream service once and retains custom scheme, suffix and proxy port', () => {
  const f = fixture();
  try {
    f.set({ installed: false, responding: false });
    const overrides = {
      STACKARR_SERVICE_URL_SCHEME: 'http',
      STACKARR_SERVICE_URL_HOST_SUFFIX: 'lab',
      PORTLESS_PORT: '8088'
    };
    f.run('install', 'app\t9000\n', overrides);
    f.run('install', 'app\t9000\n', overrides);
    assert.deepEqual(f.read().routes, [{ name: 'app.lab', port: 9000, pid: 0 }]);
    assert.equal(
      f
        .calls()
        .split('\n')
        .filter((v) => v.startsWith('service install ')).length,
      1
    );
    assert.match(f.calls(), /service install --tld lab --no-tls -p 8088/);
  } finally {
    f.cleanup();
  }
});

test('Portless noninteractive install permission failure is bounded and never registers aliases', () => {
  const f = fixture();
  try {
    f.set({ installed: false, responding: false, installFail: true });
    assert.throws(() => f.run('install'));
    assert.deepEqual(f.read().routes, []);
    assert.doesNotMatch(f.calls(), /alias |hosts sync|proxy /);
  } finally {
    f.cleanup();
  }
});

test('Portless refuses first install over unrelated routes and reports hosts sync failure honestly', () => {
  const f = fixture();
  try {
    f.set({ installed: false, responding: false, routes: [{ name: 'other.stack', port: 9123, pid: 0 }] });
    assert.throws(() => f.run('install'));
    assert.doesNotMatch(f.calls(), /service install/);
    f.set({ installed: true, responding: true, hostsFail: true });
    assert.throws(() => f.run());
    f.set({ hostsFail: false });
    f.run();
    assert.equal(
      f
        .calls()
        .split('\n')
        .filter((v) => v === 'alias app 7777').length,
      1
    );
  } finally {
    f.cleanup();
  }
});

test('Portless status performs no install, ledger, host sync or alias writes', () => {
  const f = fixture();
  try {
    assert.throws(() => f.run('status'));
    f.set({ routes: [{ name: 'app.stack', port: 7777, pid: 0 }] });
    f.run('status');
    assert.doesNotMatch(f.calls(), /alias |hosts sync|proxy |service install/);
  } finally {
    f.cleanup();
  }
});

test('Portless status rejects missing startup enrollment before reporting HTTP readiness', () => {
  const f = fixture();
  try {
    f.set({ installed: false, routes: [{ name: 'app.stack', port: 7777, pid: 0 }] });
    assert.throws(() => f.run('status'), /OS startup service is not installed/);
    assert.equal(f.curlCalls(), '');
    assert.doesNotMatch(f.calls(), /alias |hosts sync|service install/);
  } finally {
    f.cleanup();
  }
});

test('Portless HTTP readiness bypasses outbound proxies and curl user configuration', () => {
  const f = fixture();
  try {
    f.run('apply', 'app\t7777\n', { HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' });
    const calls = f
      .curlCalls()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ['--disable', '--noproxy', '*']);
    assert.equal(calls[0].at(-1), 'https://app.stack');
  } finally {
    f.cleanup();
  }
});

test('Portless reports registered but unreachable URLs without claiming readiness', () => {
  const f = fixture();
  try {
    f.set({ httpCode: '502' });
    assert.throws(() => f.run());
    assert.deepEqual(f.read().routes, [{ name: 'app.stack', port: 7777, pid: 0 }]);
    f.set({ httpCode: '401' });
    f.run('status');
  } finally {
    f.cleanup();
  }
});

test('Portless adds missing aliases and reapply preserves unrelated aliases without restarting the shared service', () => {
  const f = fixture();
  try {
    f.set({ routes: [{ name: 'other.stack', port: 9123, pid: 0 }] });
    f.run();
    f.run();
    assert.deepEqual(f.read().routes, [
      { name: 'other.stack', port: 9123, pid: 0 },
      { name: 'app.stack', port: 7777, pid: 0 }
    ]);
    assert.equal(
      f
        .calls()
        .split('\n')
        .filter((v) => v === 'alias app 7777').length,
      1
    );
    assert.doesNotMatch(f.calls(), /proxy|--force|service install|service uninstall/);
  } finally {
    f.cleanup();
  }
});
