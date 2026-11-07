#!/usr/bin/env node
'use strict';
// Capacity-only worker. It never edits lifecycle policy or starts/stops services.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const policy = require('./storage-policy.cjs');
const MAX_PATHS = 128;
const MAX_BYTES = 512 * 1024;
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const absolute = (value) =>
  typeof value === 'string' &&
  path.isAbsolute(value) &&
  value.length <= 4096 &&
  !/[\0\r\n]/.test(value) &&
  !value.split('/').some((v) => v === '.' || v === '..');
const same = (a, b) => ['realPath', 'mountPoint', 'uuid', 'filesystem'].every((key) => a[key] === b[key]);
function atomic(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
function readLedger(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return { version: 1, records: {} };
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Invalid capacity ledger');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.version !== 1 || !value.records || Array.isArray(value.records)) throw new Error('Invalid capacity ledger');
  for (const [key, record] of Object.entries(value.records)) {
    if (
      !absolute(key) ||
      record.path !== key ||
      !absolute(record.realPath) ||
      !absolute(record.mountPoint) ||
      typeof record.uuid !== 'string' ||
      !record.uuid ||
      typeof record.filesystem !== 'string'
    )
      throw new Error('Invalid capacity identity');
  }
  return value;
}
function discovery(file) {
  // No paths or commands from the bridge are passed to this host-owned exporter.
  const text = execFileSync('/bin/bash', [path.join(__dirname, 'storage-capacity-discovery.sh'), file], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      STACKARR_STORAGE_DOCKER: process.env.STACKARR_STORAGE_DOCKER,
      STACKARR_CAPACITY_PROJECT: require('./storage-control.cjs').projectName(file),
      STACKARR_COMPOSE_ENV_FILE: path.join(path.dirname(file), 'compose', '.env')
    }
  });
  return JSON.parse(text);
}
function validateDiscovery(value) {
  if (!value || !Array.isArray(value.roots) || !Array.isArray(value.issues)) throw new Error('Invalid discovery');
  if (value.roots.length > 1024 || value.issues.length > 128) throw new Error('Discovery exceeds bound');
  for (const root of value.roots) {
    if (
      !absolute(root.path) ||
      typeof root.service !== 'string' ||
      root.service.length > 100 ||
      typeof root.reason !== 'string' ||
      root.reason.length > 256 ||
      !['configuration', 'container-bind', 'native-library'].includes(root.source)
    )
      throw new Error('Invalid association');
  }
  if (new Set(value.roots.map((root) => root.path)).size > MAX_PATHS) throw new Error('Too many capacity paths');
  return value;
}
function failure(error) {
  if (['EPERM', 'EACCES'].includes(error.code)) return 'permission-denied';
  if (error.code === 'ENOENT') return 'missing';
  return 'probe-unavailable';
}
function externalMountPresent(requested, mountedAt) {
  const mac = requested.match(/^\/Volumes\/[^/]+/)?.[0];
  if (mac) return mountedAt === mac;
  const linux = requested.match(/^\/(mnt|media)(?:\/|$)/)?.[1];
  if (!linux) return true;
  const namespace = `/${linux}`;
  return (
    (mountedAt === namespace || mountedAt.startsWith(`${namespace}/`)) &&
    (requested === mountedAt || requested.startsWith(`${mountedAt}/`))
  );
}
function parseDf(line) {
  const m = line.match(/^(.*?)\s+(\d+)\s+\d+\s+(\d+)\s+(\d+)%\s+(.+)$/);
  if (
    !m ||
    !absolute(m[5]) ||
    !Number.isSafeInteger(+m[2]) ||
    +m[2] <= 0 ||
    !Number.isSafeInteger(+m[3]) ||
    +m[3] < 0 ||
    +m[3] > +m[2] ||
    +m[4] > 100
  )
    throw new Error('Invalid host df');
  return { filesystem: m[1], mountPoint: m[5], totalKilobytes: +m[2], availableKilobytes: +m[3], usedPercent: +m[4] };
}
function snapshot(paths) {
  const rows = new Map();
  const existing = [];
  const missing = [];
  for (const requested of paths) {
    try {
      const realPath = fs.realpathSync(requested);
      const stat = fs.statSync(realPath);
      existing.push({ requested, realPath, dev: stat.dev, ino: stat.ino });
    } catch (error) {
      rows.set(requested, { status: failure(error), usage: null });
      if (error.code === 'ENOENT') {
        // Walk only to a real, accessible ancestor. Never infer a mount from
        // the requested string or follow a dangling/retargeted leaf symlink.
        try {
          if (fs.lstatSync(requested, { throwIfNoEntry: false })) continue;
          let anchor = path.dirname(requested);
          while (!fs.existsSync(anchor) && anchor !== '/') {
            if (fs.lstatSync(anchor, { throwIfNoEntry: false })) throw new Error('Dangling ancestor');
            anchor = path.dirname(anchor);
          }
          const realPath = fs.realpathSync(anchor);
          const stat = fs.statSync(realPath);
          if (stat.isDirectory()) missing.push({ requested, anchor, realPath, dev: stat.dev });
        } catch {
          /* No independent enclosing proof. */
        }
      }
    }
  }
  const measured = [...existing, ...missing];
  if (!measured.length) return rows;
  // One kernel df invocation for the complete path set. Every row stays bound by
  // position, and a command/row-count failure discards the complete snapshot.
  const output = execFileSync(
    process.platform === 'darwin' ? '/bin/df' : 'df',
    ['-kP', ...measured.map((v) => v.realPath)],
    {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: MAX_BYTES,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
    .trim()
    .split(/\r?\n/)
    .slice(1);
  if (output.length !== measured.length) throw new Error('Incomplete host df');
  const volumes = new Map();
  for (let i = 0; i < existing.length; i++) {
    const item = existing[i];
    try {
      const usage = parseDf(output[i]);
      if (!externalMountPresent(item.requested, usage.mountPoint)) {
        rows.set(item.requested, { status: 'unmounted', usage: null });
        continue;
      }
      const key = JSON.stringify([usage.filesystem, usage.mountPoint, item.dev]);
      if (!volumes.has(key)) volumes.set(key, policy.inspectVolume(usage.mountPoint));
      const volume = volumes.get(key);
      if (volume.mountPoint !== usage.mountPoint || fs.statSync(volume.mountPoint).dev !== item.dev)
        throw new Error('Mount changed');
      const record = policy.captureRoot(item.requested, { allowReadOnly: true, probe: () => volume });
      if (fs.realpathSync(item.requested) !== item.realPath) throw new Error('Path changed');
      rows.set(item.requested, {
        status: 'available',
        record,
        dev: item.dev,
        ino: item.ino,
        usage: { ...usage, realPath: record.realPath, volumeId: record.uuid, requestedPath: item.requested }
      });
    } catch (error) {
      rows.set(item.requested, { status: failure(error), usage: null });
    }
  }
  for (let i = 0; i < missing.length; i++) {
    const item = missing[i];
    try {
      const usage = parseDf(output[existing.length + i]);
      // Use the resolved ancestor for an alias, but never allow an unresolved
      // external namespace to borrow the internal parent filesystem.
      if (
        !externalMountPresent(item.realPath, usage.mountPoint) ||
        (item.realPath === item.anchor && !externalMountPresent(item.requested, usage.mountPoint))
      )
        continue;
      const volume = policy.inspectVolume(usage.mountPoint);
      if (
        volume.mountPoint !== usage.mountPoint ||
        fs.statSync(volume.mountPoint).dev !== item.dev ||
        fs.realpathSync(item.anchor) !== item.realPath ||
        fs.statSync(item.realPath).dev !== item.dev
      )
        continue;
      const anchorRecord = policy.captureRoot(item.anchor, { allowReadOnly: true, probe: () => volume });
      rows.get(item.requested).enclosingMount = {
        filesystem: usage.filesystem,
        filesystemType: volume.filesystem,
        mountPoint: usage.mountPoint,
        volumeId: volume.uuid,
        realAnchor: anchorRecord.realPath,
        anchor: item.anchor
      };
    } catch {
      /* A failed ancestor proof never changes the path's status. */
    }
  }
  return rows;
}
function report(file, adapters = {}) {
  const lock = path.join(path.dirname(file), 'storage-capacity.lock');
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST' || fs.lstatSync(lock).isSymbolicLink()) throw error;
    const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid capacity lock');
    try {
      process.kill(pid, 0);
      throw new Error('Capacity worker active');
    } catch (alive) {
      if (alive.code !== 'ESRCH') throw alive;
    }
    fs.unlinkSync(path.join(lock, 'pid'));
    fs.rmdirSync(lock);
    fs.mkdirSync(lock, { mode: 0o700 });
  }
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { flag: 'wx', mode: 0o600 });
  try {
    return lockedReport(file, adapters);
  } finally {
    fs.unlinkSync(path.join(lock, 'pid'));
    fs.rmdirSync(lock);
  }
}
function lockedReport(file, adapters) {
  const digest = hash(file);
  const found = validateDiscovery((adapters.discover || discovery)(file));
  const paths = [...new Set(found.roots.map((root) => root.path))];
  const ledgerFile = path.join(path.dirname(file), 'storage-capacity-identities.json');
  const ledger = readLedger(ledgerFile);
  const current = policy.readPolicy(file);
  const before = (adapters.snapshot || snapshot)(paths);
  const after = (adapters.snapshot || snapshot)(paths);
  const entries = paths.map((requested) => {
    const a = before.get(requested),
      b = after.get(requested);
    const pinned =
      ledger.records[requested] ||
      [...current.roots, ...(current.observations || [])].find((v) => v.path === requested);
    if (!a || !b) return { path: requested, status: 'probe-unavailable', usage: null };
    if (!a.usage || !b.usage) {
      let status = !a.usage ? a.status : b.status;
      if (pinned && status === 'missing')
        status = require('./storage-control.cjs').capacityFailure({ code: 'ENOENT', message: '' }, pinned);
      const x = a.enclosingMount,
        y = b.enclosingMount;
      const compatible =
        x &&
        y &&
        JSON.stringify(x) === JSON.stringify(y) &&
        (!pinned ||
          (pinned.mountPoint === y.mountPoint &&
            pinned.uuid === y.volumeId &&
            pinned.filesystem === y.filesystemType &&
            (pinned.realPath === y.realAnchor || pinned.realPath.startsWith(`${y.realAnchor}/`))));
      return {
        path: requested,
        status,
        usage: null,
        ...(status === 'missing' && compatible ? { enclosingMount: y } : {})
      };
    }
    if (
      !same(a.record, b.record) ||
      a.dev !== b.dev ||
      a.ino !== b.ino ||
      a.usage.filesystem !== b.usage.filesystem ||
      (pinned && !same(pinned, b.record))
    )
      return { path: requested, status: 'stale-identity', usage: null };
    if (!pinned && Object.keys(ledger.records).length >= 1024)
      return { path: requested, status: 'probe-unavailable', usage: null };
    ledger.records[requested] = pinned || b.record;
    return { path: requested, status: 'available', usage: b.usage };
  });
  const confirmed = validateDiscovery((adapters.discover || discovery)(file));
  const signature = (value) => JSON.stringify(value.roots.map((root) => JSON.stringify(root)).sort());
  if (hash(file) !== digest || signature(found) !== signature(confirmed)) throw new Error('Authority changed');
  // Keep inactive pins as tombstones. Re-adding a path cannot silently adopt a
  // replacement volume. Current discovery alone controls present authorization.
  atomic(ledgerFile, ledger);
  return { roots: found.roots, issues: found.issues, entries };
}
function runRequest(file, requestFile) {
  const name = path.basename(requestFile);
  const bridge = path.join(path.dirname(file), 'storage-bridge');
  if (!/^[a-f0-9]{32}\.request$/.test(name) || path.dirname(requestFile) !== bridge)
    throw new Error('Invalid request path');
  const stat = fs.lstatSync(requestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('Invalid request');
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  const nonce = name.slice(0, 32);
  if (
    request.nonce !== nonce ||
    request.operation !== 'capacity-report' ||
    Object.keys(request).sort().join(',') !== 'at,digest,nonce,operation' ||
    request.digest !== hash(file) ||
    !Number.isFinite(request.at) ||
    request.at > Date.now() ||
    Date.now() - request.at > 10000
  )
    throw new Error('Invalid request binding');
  let data;
  try {
    data = report(file);
  } catch {
    /* Failure is explicitly unavailable, never a stale snapshot. */
  }
  if (!fs.existsSync(requestFile) || hash(file) !== request.digest || Date.now() - request.at > 10000) return;
  atomic(path.join(bridge, `${nonce}.response`), {
    nonce,
    digest: request.digest,
    at: Date.now(),
    ready: Boolean(data),
    ...data
  });
  fs.rmSync(requestFile, { force: true });
}
module.exports = { report, snapshot, validateDiscovery, runRequest, readLedger, externalMountPresent };
if (require.main === module) {
  try {
    const [file, request] = process.argv.slice(2);
    if (request === '--reconcile') report(file);
    else runRequest(file, request);
  } catch {
    process.exitCode = 1;
  }
}
