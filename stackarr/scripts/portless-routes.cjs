#!/usr/bin/env node
// Use only Portless's public CLI. This file owns Stackarr's ledger, never the
// shared proxy's private state. 0.15.11 has no JSON list or alias --tld option.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PORTLESS_SYNC_HOSTS: '0' };
const suffix = env.STACKARR_SERVICE_URL_HOST_SUFFIX || 'stack';
const scheme = env.STACKARR_SERVICE_URL_SCHEME || 'https';
const port = Number(env.PORTLESS_PORT || (scheme === 'https' ? 443 : 80));
const command = process.argv[2] || 'apply';
const error = (message) => {
  throw new Error(message);
};
const cli = (args, attended = false, diagnostic = false) => {
  const result = spawnSync('portless', args, {
    env,
    encoding: 'utf8',
    timeout: attended ? 120000 : 30000,
    stdio: attended && process.stdout.isTTY ? 'inherit' : ['ignore', 'pipe', 'pipe']
  });
  if (result.error || (result.status !== 0 && !(diagnostic && result.status === 1)))
    error(
      `portless ${args.join(' ')} failed. Complete any required host administrator approval in a terminal, then retry. ${result.error?.message || ''}`
    );
  return (result.stdout || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
};
function inventory() {
  const text = cli(['list']);
  if (/^No active routes\.\s*(?:Start an app with: portless <name> <command>)?$/.test(text)) return {};
  if (!text.startsWith('Active routes:')) error('Unrecognized Portless list output; no routes changed.');
  const routes = {};
  for (const line of text
    .slice('Active routes:'.length)
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)) {
    // Tunnel annotations do not change the local route, but unknown route formats
    // must fail closed instead of hiding a collision.
    if (/^(tailscale|funnel|ngrok|cloudflare): https:\/\//.test(line)) continue;
    const match = line.match(
      /^(https?:\/\/[a-z0-9.-]+(?::\d+)?)\s+->\s+localhost:(\d+)\s+\((alias|pid \d+)\)(?: up .+)?$/
    );
    if (!match) error('Unrecognized Portless route; no unsafe reconciliation attempted.');
    const url = new URL(match[1]);
    if (routes[url.hostname]) error('Duplicate Portless hostname.');
    routes[url.hostname] = { port: Number(match[2]), alias: match[3] === 'alias', url: match[1] };
  }
  return routes;
}
function serviceStatus() {
  const text = cli(['service', 'status']);
  const proxy = text.match(/^\s*Proxy on (\d+): (responding|not responding)$/m);
  const installed = text.match(/^\s*Installed: (yes|no)$/m);
  const tls = text.match(/^\s*HTTPS: (yes|no)$/m);
  const tld = text.match(/^\s*TLDs: (.+)$/m);
  const state = text.match(/^\s*State directory: (.+)$/m);
  if (!proxy || !installed || !tls || !tld || !state) error('Unrecognized Portless service status.');
  return {
    text,
    installed: installed[1] === 'yes',
    responding: proxy[2] === 'responding',
    port: Number(proxy[1]),
    scheme: tls[1] === 'yes' ? 'https' : 'http',
    suffix: tld[1],
    state: state[1],
    lan: /^\s*LAN mode: yes$/m.test(text)
  };
}
function ready(status) {
  if (
    !status.responding ||
    status.port !== port ||
    status.scheme !== scheme ||
    status.suffix !== `.${suffix}` ||
    status.lan
  ) {
    error(
      `Proxy not ready for ${scheme}://*.${suffix} on ${port}. Existing proxy/settings left unchanged. Inspect 'portless service status'; resolve service, suffix, scheme or multi-TLD/LAN conflicts explicitly. Localhost service ports remain available.`
    );
  }
  if (env.PORTLESS_STATE_DIR && path.resolve(env.PORTLESS_STATE_DIR) !== path.resolve(status.state))
    error('Portless service and requested state directory differ.');
  // Pin all subsequent public CLI operations to the service-reported directory.
  env.PORTLESS_STATE_DIR = status.state;
  // Service configuration can be stale. Doctor reports the actual discovered
  // proxy state that alias/remove will use, including every active TLD.
  const diagnostic = cli(['doctor'], false, true);
  if (
    !diagnostic.split('\n').includes(`Mode: ${scheme.toUpperCase()}, .${suffix}`) ||
    !diagnostic.split('\n').includes(`Proxy target: ${expectedUrl('127.0.0.1')}`)
  )
    error('Active proxy mode differs from its startup service. No aliases changed.');
}
function expectedUrl(name) {
  return `${scheme}://${name}${port === (scheme === 'https' ? 443 : 80) ? '' : `:${port}`}`;
}
const matches = (route, number) => route?.alias && route.port === number;
function verifyRoutes(desired) {
  const current = inventory();
  for (const [name, number] of Object.entries(desired)) {
    if (!matches(current[name], number) || current[name].url !== expectedUrl(name))
      error(`Missing or mismatched alias ${name}. Run 'stackarr portless apply'.`);
    const probe = spawnSync(
      'curl',
      [
        '--disable',
        '--noproxy',
        '*',
        '--silent',
        '--show-error',
        '--connect-timeout',
        '2',
        '--max-time',
        '5',
        '--output',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        '--write-out',
        '%{http_code}',
        expectedUrl(name)
      ],
      { encoding: 'utf8', timeout: 7000 }
    );
    const status = Number(probe.stdout);
    if (probe.error || probe.status !== 0 || status < 200 || status >= 500)
      error(
        `Alias ${name} is registered but DNS/TLS/HTTP readiness failed. Direct localhost:${number} remains the fallback; inspect the proxy and origin.`
      );
    console.log(`${expectedUrl(name)} -> localhost:${number}: HTTP ${status}`);
  }
}
function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) error('Portless requires Node.js 24+.');
  if (!['apply', 'install', 'status', 'uninstall'].includes(command)) error('Unknown Portless action.');
  if (
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(suffix) ||
    !['https', 'http'].includes(scheme) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    error('Invalid Portless suffix, scheme or port.');
  const version = cli(['--version']);
  const parts = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (
    !parts ||
    (Number(parts[1]) === 0 && (Number(parts[2]) < 15 || (Number(parts[2]) === 15 && Number(parts[3]) < 11)))
  )
    error(
      'Portless 0.15.11 or newer is required (Node.js 24+). Upgrade explicitly; Stackarr never upgrades a shared proxy automatically.'
    );
  let status = serviceStatus();
  const desired = {};
  if (command !== 'uninstall') {
    for (const line of fs.readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
      const [name, value, extra] = line.split('\t');
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
        !/^\d+$/.test(value) ||
        extra !== undefined ||
        Number(value) < 1 ||
        Number(value) > 65535
      )
        error('Invalid desired alias.');
      if (desired[`${name}.${suffix}`]) error('Duplicate desired alias.');
      desired[`${name}.${suffix}`] = Number(value);
    }
  }
  if (command === 'install' && !status.installed) {
    if (status.responding || Object.keys(inventory()).length)
      error(
        'Existing unmanaged proxy/routes retained. Enroll the shared proxy explicitly with its existing options before retrying install.'
      );
    // This is the ONLY service mutation: explicit first installation on an empty
    // proxy. Upstream owns launchd/systemd and one-time privilege/CA consent.
    cli(
      [
        'service',
        'install',
        '--tld',
        suffix,
        scheme === 'https' ? '--https' : '--no-tls',
        '-p',
        String(port),
        ...(env.PORTLESS_STATE_DIR ? ['--state-dir', env.PORTLESS_STATE_DIR] : [])
      ],
      true
    );
    status = serviceStatus();
  }
  ready(status);
  if (command === 'status') {
    console.log(status.text);
    if (!status.installed) error('Proxy responds but OS startup service is not installed.');
    verifyRoutes(desired);
    return;
  }
  if (!status.installed)
    console.warn(
      'Proxy is responding without an OS startup service. Persistence across logout/reboot is not established.'
    );
  if (!env.STATE_ROOT) error('STATE_ROOT is required for the installation-owned alias ledger.');
  const directory = path.join(env.STATE_ROOT, 'portless');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'reconcile.lock');
  try {
    fs.mkdirSync(lock);
  } catch {
    error(`Another reconciliation or interrupted run holds ${lock}. Inspect it before retrying.`);
  }
  try {
    const ledgerFile = path.join(directory, 'aliases.json');
    let owned = {};
    if (fs.existsSync(ledgerFile)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      if (ledger.version !== 1 || ledger.state !== status.state || !ledger.owned || Array.isArray(ledger.owned))
        error('Invalid or different-proxy alias ledger; retained without changes.');
      owned = ledger.owned;
      for (const [name, number] of Object.entries(owned))
        if (!/^[a-z0-9.-]+$/.test(name) || !Number.isInteger(number) || number < 1 || number > 65535)
          error('Invalid owned alias record.');
    }
    const save = () => {
      const temporary = `${ledgerFile}.${process.pid}`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, state: status.state, owned }, null, 2)}\n`, {
        mode: 0o600
      });
      fs.renameSync(temporary, ledgerFile);
    };
    const before = inventory();
    const managedBefore = { ...owned };
    for (const [name, number] of Object.entries(desired)) {
      const existing = before[name];
      if (
        existing &&
        (existing.url !== expectedUrl(name) || (!matches(existing, number) && !matches(existing, owned[name])))
      )
        error(`Conflicting route ${name}; not owned by this installation. No routes changed.`);
    }
    for (const [name, number] of Object.entries(desired)) {
      const existing = inventory()[name];
      if (matches(existing, number)) continue; // Never adopt pre-existing aliases.
      if (existing && !matches(existing, owned[name])) error(`Route ${name} changed concurrently; left untouched.`);
      cli(['alias', name.slice(0, -(suffix.length + 1)), String(number)]);
      if (!matches(inventory()[name], number)) error(`Alias readback failed for ${name}.`);
      owned[name] = number;
      save(); // Journal each successful operation for retry after partial failure.
    }
    for (const [name, number] of Object.entries(owned)) {
      if (desired[name]) continue;
      // 0.15.11 expands every alias through the proxy TLD. Never remove another
      // suffix or an alias whose endpoint/owner changed since we created it.
      if (!name.endsWith(`.${suffix}`)) {
        console.warn(`Retained old-suffix alias ${name}; review it explicitly.`);
        continue;
      }
      const current = inventory()[name];
      if (!current) {
        delete owned[name];
        save();
        continue;
      }
      if (!matches(current, number)) {
        console.warn(`Retained changed alias ${name}; ownership released.`);
        delete owned[name];
        save();
        continue;
      }
      cli(['alias', '--remove', name.slice(0, -(suffix.length + 1))]);
      if (inventory()[name]) error(`Alias removal readback failed for ${name}.`);
      delete owned[name];
      save();
    }
    save();
    const after = inventory();
    for (const [name, route] of Object.entries(before)) {
      if (!(name in desired) && !(name in managedBefore) && JSON.stringify(after[name]) !== JSON.stringify(route))
        error(`Unrelated route changed during reconciliation: ${name}.`);
    }
    cli(['hosts', 'sync'], true);
    verifyRoutes(desired);
    console.log(
      `Verified ${Object.keys(desired).length} Stackarr aliases and HTTP reachability (not authenticated application health). Existing unowned aliases and the shared proxy service were retained.`
    );
    if (command === 'uninstall')
      console.log(
        'Only ledger-owned aliases removed. The shared upstream service and legacy login agent were not uninstalled.'
      );
  } finally {
    fs.rmdirSync(lock);
  }
}
try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
