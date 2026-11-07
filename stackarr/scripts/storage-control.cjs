#!/usr/bin/env node
// Host-owned safety coordination. This is an availability guard, not a security boundary.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
let capacityWorker = null;
function startCapacityWorker(file, request) {
  if (capacityWorker) return;
  const child = spawn(process.execPath, [path.join(__dirname, 'storage-capacity.cjs'), file, request], {
    stdio: 'ignore', detached: true
  });
  capacityWorker = child;
  const timer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
  }, 9000);
  const clear = () => {
    // exec timeouts may kill a shell before its descendants. Reap the entire
    // dedicated worker group even on an early exit, never an unrelated process.
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    clearTimeout(timer);
    if (capacityWorker === child) capacityWorker = null;
  };
  child.once('error', clear);
  child.once('exit', clear);
}
const policy = require('./storage-policy.cjs');

function atomic(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
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
}
function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function bridgeDir(file) {
  return path.join(path.dirname(file), 'storage-bridge');
}
function enrollmentFile(file) {
  return path.join(path.dirname(file), 'storage-enrollment.json');
}
function enrollment(file) {
  const marker = enrollmentFile(file);
  if (!fs.existsSync(marker)) return null;
  if (fs.lstatSync(marker).isSymbolicLink()) throw new Error('Invalid enrollment marker');
  const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (
    value.version !== 1 ||
    !['preparing', 'ready'].includes(value.phase) ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(value.project)
  )
    throw new Error('Invalid enrollment marker');
  return value;
}
function checkHost(file, check = policy.checkPolicy) {
  if (!fs.existsSync(file)) throw new Error('Storage policy is unavailable');
  const marker = enrollment(file);
  if (marker && marker.phase !== 'ready') throw new Error('Storage enrollment is unfinished');
  const journal = path.join(path.dirname(file), 'storage-migration.json');
  if (fs.lstatSync(journal, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error('Storage migration journal is a symlink');
  if (fs.existsSync(`${journal}.lock`)) throw new Error('Storage migration is active or needs recovery');
  if (fs.existsSync(journal)) {
    const state = JSON.parse(fs.readFileSync(journal, 'utf8'));
    if (!['completed', 'rolled-back'].includes(state.phase)) {
      throw new Error('Storage migration is unfinished; recover it before starting services');
    }
  }
  check(file);
}
function projectName(file) {
  const name = enrollment(file)?.project || policy.readPolicy(file).project || 'stackarr';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('Invalid Compose project');
  return name;
}
function docker(args) {
  return execFileSync(process.env.STACKARR_STORAGE_DOCKER || 'docker', args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
function containers(project, run = docker) {
  return run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
function stopNamedProject(project, run = docker) {
  const ids = containers(project, run);
  // Disable restart before stopping, including stopped containers on daemon restart.
  for (const id of ids) run(['update', '--restart=no', id]);
  if (ids.length) run(['stop', '--time', '30', ...ids]);
  return ids.length;
}
function removeProject(file, run = docker) {
  stopProject(file, run);
  const ids = containers(projectName(file), run);
  if (ids.length) run(['rm', ...ids]); // Never remove volume data.
  return ids.length;
}
function stopProject(file, run = docker) {
  return stopNamedProject(projectName(file), run);
}
function prepare(file, project, run = docker, validate = require('./storage-monitor-install.cjs').internalPaths) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Invalid Compose project');
  const current = policy.readPolicy(file);
  validate([path.dirname(file)]);
  const marker = enrollment(file);
  if (marker && marker.project !== project) throw new Error('Enrollment belongs to a different project');
  if (marker?.phase === 'ready' && !fs.existsSync(file))
    throw new Error('Restore the missing policy before re-preparing');
  if (current.project && current.project !== project) throw new Error('Policy belongs to a different project');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomic(enrollmentFile(file), { version: 1, phase: 'preparing', project });
  const bridge = bridgeDir(file);
  fs.mkdirSync(bridge, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(bridge).isSymbolicLink()) throw new Error('Bridge must not be a symlink');
  const ids = containers(project, run);
  for (const id of ids) run(['update', '--restart=no', id]);
  if (ids.length) {
    const restart = run(['inspect', '--format', '{{.HostConfig.RestartPolicy.Name}}', ...ids])
      .trim()
      .split(/\s+/);
    if (restart.length !== ids.length || restart.some((value) => value !== 'no'))
      throw new Error('Restart-policy verification failed');
  }
  if (containers(project, run).sort().join('\n') !== ids.sort().join('\n'))
    throw new Error('Container inventory changed during enrollment; retry');
  policy.writePolicy(file, { ...current, project });
  atomic(enrollmentFile(file), { version: 1, phase: 'ready', project });
}
function protect(file, root) {
  const current = policy.readPolicy(file);
  const record = policy.captureRoot(root);
  const roots = current.roots.filter((entry) => entry.path !== record.path);
  policy.writePolicy(file, { ...current, roots: [...roots, record] });
}
const within = (child, parent) => child === parent || child.startsWith(`${parent.replace(/\/$/, '')}/`);
function capacityRoot(current, requested) {
  return [...current.roots, ...(current.observations || [])]
    .filter(entry => within(requested, entry.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
// An enrolled ancestor authorizes inspection, but is never proof of a child.
// A nested mount or escaping symlink needs its own explicit enrollment.
function usageForRoot(file, requested, run = execFileSync, verify = policy.verifyRoot) {
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || /[\0\r\n]/.test(requested) ||
      requested.split('/').some(part => part === '.' || part === '..')) throw new Error('Unenrolled capacity path');
  const current = policy.readPolicy(file);
  const state = path.dirname(file);
  const record = capacityRoot(current, requested);
  if (!within(requested, state) && !record) throw new Error('Unenrolled capacity path');
  // Observations are checked here, never in the lifecycle stop guard.
  if (record) verify(record, { allowReadOnly: (current.observations || []).includes(record) });
  const exactRecord = () => {
    const exact = requested === record.path ? record : policy.captureRoot(requested, { allowReadOnly: true });
    if (!within(exact.realPath, record.realPath) || exact.mountPoint !== record.mountPoint ||
        exact.uuid !== record.uuid || exact.filesystem !== record.filesystem)
      throw new Error('capacity path identity changed or escaped enrollment');
    return exact;
  };
  const identity = record ? exactRecord() : null;
  const target = identity ? identity.realPath : fs.realpathSync(requested);
  if (!record && (!within(target, fs.realpathSync(state)) || fs.statSync(target).dev !== fs.statSync(state).dev))
    throw new Error('capacity path identity changed or escaped enrollment');
  const output = run(process.platform === 'darwin' ? '/bin/df' : 'df', ['-kP', target], {
    encoding: 'utf8',
    timeout: 2500,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const line = output.trim().split(/\r?\n/).at(-1);
  const match = line?.match(/^(.*?)\s+(\d+)\s+\d+\s+(\d+)\s+(\d+)%\s+(.+)$/);
  if (
    !match ||
    !Number.isSafeInteger(Number(match[2])) ||
    !Number.isSafeInteger(Number(match[3])) ||
    Number(match[2]) <= 0 ||
    Number(match[3]) < 0 ||
    Number(match[3]) > Number(match[2]) ||
    Number(match[4]) > 100 ||
    (record && match[5] !== record.mountPoint)
  )
    throw new Error('Invalid host capacity');
  if (record) {
    verify(record, { allowReadOnly: (current.observations || []).includes(record) });
    if (exactRecord().realPath !== target) throw new Error('capacity path symlink retargeted');
  } else if (fs.realpathSync(requested) !== target || fs.statSync(target).dev !== fs.statSync(state).dev) {
    throw new Error('capacity path symlink retargeted');
  }
  return {
    filesystem: match[1],
    requestedPath: requested,
    realPath: target,
    ...(identity ? { volumeId: identity.uuid } : {}),
    totalKilobytes: Number(match[2]),
    availableKilobytes: Number(match[3]),
    usedPercent: Number(match[4]),
    mountPoint: match[5]
  };
}
function observe(file, root) {
  const current = policy.readPolicy(file);
  const record = policy.captureRoot(root, { allowReadOnly: true });
  policy.writePolicy(file, {
    ...current,
    observations: [...(current.observations || []).filter(entry => entry.path !== record.path), record]
  });
}
function capacityFailure(error, record) {
  if (['EACCES', 'EPERM'].includes(error.code)) return 'permission-denied';
  if (record?.mountPoint) {
    try {
      fs.realpathSync(record.mountPoint);
    } catch (mountError) {
      if (['EACCES', 'EPERM'].includes(mountError.code)) return 'permission-denied';
      if (mountError.code === 'ENOENT') return 'unmounted';
      return 'probe-unavailable';
    }
    try {
      // Identify a parent-filesystem fallback before requiring a UUID or a
      // supported filesystem: an unmounted disk may leave its directory on
      // tmpfs or another filesystem that cannot supply a volume identity.
      const output = execFileSync(process.platform === 'darwin' ? '/bin/df' : 'df', ['-kP', record.mountPoint], {
        encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore']
      });
      const mountedAt = output.trim().split(/\r?\n/).at(-1)?.match(/\d+%\s+(.+)$/)?.[1];
      if (!mountedAt || !path.isAbsolute(mountedAt)) return 'probe-unavailable';
      if (mountedAt !== record.mountPoint) return 'unmounted';
      const actual = policy.inspectVolume(record.mountPoint);
      if (actual.mountPoint !== record.mountPoint) return 'unmounted';
      if (actual.uuid !== record.uuid || actual.filesystem !== record.filesystem) return 'stale-identity';
    } catch (mountError) {
      if (['EACCES', 'EPERM'].includes(mountError.code)) return 'permission-denied';
      // An OS probe can itself fail with ENOENT (for example missing findmnt).
      // Without mount proof, do not diagnose a missing leaf or borrow capacity.
      return 'probe-unavailable';
    }
  }
  if (error.code === 'ENOENT') return 'missing';
  if (/Unenrolled/.test(error.message)) return 'not-enrolled';
  if (/symlink retargeted|identity changed|path does not belong to reported mount/.test(error.message)) return 'stale-identity';
  return 'probe-unavailable';
}
function respond(file, check = checkHost, now = Date.now) {
  const dir = bridgeDir(file);
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) throw new Error('Storage bridge is unavailable');
  for (const name of fs.readdirSync(dir).slice(0, 256)) {
    if (!/^[a-f0-9]{32}\.(request|response)$/.test(name)) continue;
    const entry = path.join(dir, name);
    let stat;
    try {
      stat = fs.lstatSync(entry);
      if (!stat.isFile()) continue;
      if (now() - stat.mtimeMs > 30000) {
        fs.unlinkSync(entry);
        continue;
      }
    } catch (error) {
      // Clients remove their own request/response after consuming a proof.
      // A listed entry may disappear before stat or expired-entry cleanup.
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!name.endsWith('.request') || stat.size > 1024) continue;
    try {
      const request = JSON.parse(fs.readFileSync(entry, 'utf8'));
      const nonce = name.slice(0, 32);
      if (
        request.nonce !== nonce ||
        request.digest !== digest(file) ||
        !Number.isFinite(request.at) ||
        request.at > now() ||
        now() - request.at > 10000
      )
        continue;
      if (request.operation === 'capacity-report') {
        // Capacity is independent of lifecycle roots. Keep discovery and native
        // probes out of the monitor safety loop and bound the whole worker tree.
        startCapacityWorker(file, entry);
        continue;
      }
      let ready = false;
      try {
        check(file);
        ready = true;
      } catch {
        /* Fail closed without leaking OS errors. */
      }
      let usage;
      let status = ready ? 'available' : 'guard-unavailable';
      if (ready && request.operation === 'usage') {
        try {
          usage = usageForRoot(file, request.path);
        } catch (error) {
          ready = false;
          status = capacityFailure(error, capacityRoot(policy.readPolicy(file), request.path));
        }
      } else if (request.operation !== undefined) ready = false;
      atomic(path.join(dir, `${nonce}.response`), {
        nonce,
        digest: request.digest,
        ready,
        at: now(),
        ...(request.operation === 'usage' ? { status } : {}),
        ...(usage ? { usage } : {})
      });
      fs.unlinkSync(entry);
    } catch {
      /* Ignore malformed requests. */
    }
  }
}
async function checkGuestAttempt(file, timeout, now) {
  const dir = bridgeDir(file);
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink())
    throw new Error('Install the host storage monitor before container actions');
  const nonce = crypto.randomBytes(16).toString('hex');
  const hash = digest(file);
  const at = now();
  const request = path.join(dir, `${nonce}.request`);
  const response = path.join(dir, `${nonce}.response`);
  atomic(request, { nonce, digest: hash, at });
  try {
    while (now() - at < timeout) {
      if (fs.existsSync(response)) {
        const stat = fs.lstatSync(response);
        if (!stat.isFile() || stat.size > 1024) break;
        const reply = JSON.parse(fs.readFileSync(response, 'utf8'));
        if (
          reply.nonce === nonce &&
          reply.digest === hash &&
          digest(file) === hash &&
          reply.ready === true &&
          reply.at >= at &&
          reply.at <= now() &&
          now() - reply.at <= 10000
        )
          return true;
        // A negative or malformed response must not be retried as a timeout.
        throw new Error('Host storage proof denied or invalid; action blocked');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  } finally {
    for (const file of [request, response]) fs.rmSync(file, { force: true });
  }
}
// Request a host-checked identity for the exact existing archive ancestor.
// Unlike a generic readiness proof, this detects an unmounted/replaced child
// even when its enrolled media parent is invisible in the updater container.
async function checkGuestArchive(file, requested, { timeout = 3500, attempts = 2, now = Date.now } = {}) {
  const current = policy.readPolicy(file);
  const record = current.roots.filter(entry => within(requested, entry.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!record || !path.isAbsolute(requested) || /[\0\r\n]/.test(requested) ||
      requested.split('/').some(part => part === '.' || part === '..'))
    throw new Error('Archive ancestor is not enrolled');
  const dir = bridgeDir(file);
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink())
    throw new Error('Host storage bridge unavailable');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const hash = digest(file);
    const at = now();
    const request = path.join(dir, `${nonce}.request`);
    const response = path.join(dir, `${nonce}.response`);
    atomic(request, { nonce, digest: hash, at, operation: 'usage', path: requested });
    try {
      while (now() - at < timeout) {
        if (fs.existsSync(response)) {
          const stat = fs.lstatSync(response);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
            throw new Error('Invalid archive proof');
          const reply = JSON.parse(fs.readFileSync(response, 'utf8'));
          const usage = reply.usage;
          const expected = path.join(record.realPath, path.relative(record.path, requested));
          if (reply.nonce !== nonce || reply.digest !== hash || digest(file) !== hash ||
              reply.ready !== true || !Number.isFinite(reply.at) || reply.at < at ||
              reply.at > now() || now() - reply.at > 10000 ||
              usage?.requestedPath !== requested || usage.realPath !== expected ||
              usage.mountPoint !== record.mountPoint || usage.volumeId !== record.uuid)
            throw new Error('Host archive identity denied or invalid');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      for (const entry of [request, response]) fs.rmSync(entry, { force: true });
    }
  }
  throw new Error('Host archive proof absent or unavailable');
}
async function checkGuest(file, { timeout = 8000, attempts = 2, now = Date.now } = {}) {
  // Host pressure may delay one response. Each attempt has a fresh nonce and
  // must pass all existing policy/digest/freshness checks. Denials fail closed.
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await checkGuestAttempt(file, timeout, now)) return;
  }
  throw new Error('Host storage proof absent, stale or unavailable; action blocked');
}
function composeOverride(file, source, rendered) {
  const text = fs.readFileSync(source, 'utf8').split(/^volumes:\s*$/m)[0];
  const services = {};
  for (const match of text.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)) services[match[1]] = { restart: 'no' };
  if (!services.stackarr || !services['app-updater']) throw new Error('Unrecognized Compose service layout');
  if (rendered) {
    for (const [name, service] of Object.entries(rendered.services || {})) {
      if (!services[name]) throw new Error('Unexpected Compose service');
      services[name].volumes = (service.volumes || []).map((volume) =>
        volume.type === 'bind' ? { ...volume, bind: { ...volume.bind, create_host_path: false } } : volume
      );
    }
  }
  // Compose config output already escapes literal dollars for round-tripping.
  // Only the new host paths below need escaping, never the rendered topology.
  const policyPath = file.replaceAll('$', () => '$$');
  const bridgePath = bridgeDir(file).replaceAll('$', () => '$$');
  for (const name of ['stackarr', 'app-updater']) {
    services[name].environment = { STACKARR_STORAGE_POLICY: policyPath };
    services[name].volumes = [
      ...(services[name].volumes || []),
      { type: 'bind', source: policyPath, target: policyPath, read_only: true, bind: { create_host_path: false } },
      { type: 'bind', source: bridgePath, target: bridgePath, bind: { create_host_path: false } }
    ];
  }
  return { services };
}
async function watch(file) {
  const project = projectName(file); // Retain containment scope after policy/marker loss.
  let stopped = false;
  let nextCapacityReconciliation = 0;
  for (;;) {
    try {
      checkHost(file);
      // Never automatically restart after a disconnect or interrupted migration.
    } catch {
      try {
        const count = stopNamedProject(project);
        if (!stopped)
          console.error(
            `Storage unavailable: stopped ${count} managed containers. Reconnect, check, then run stackarr up.`
          );
        stopped = true;
      } catch {
        console.error('Storage unavailable; Docker stop could not be confirmed.');
      }
    }
    try {
      respond(file);
      if (!capacityWorker && Date.now() >= nextCapacityReconciliation) {
        startCapacityWorker(file, '--reconcile');
        nextCapacityReconciliation = Date.now() + 60000;
      }
    } catch {
      console.error('Storage responder unavailable.');
    }
    try {
      require('./storage-move.cjs').consume(file);
    } catch {
      console.error('Storage relocation request unavailable.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
module.exports = {
  projectName,
  checkHost,
  checkGuest,
  checkGuestArchive,
  prepare,
  protect,
  stopProject,
  removeProject,
  respond,
  composeOverride,
  bridgeDir,
  usageForRoot
  ,observe,
  capacityFailure
};
if (require.main === module) {
  (async () => {
    const [command, file, arg] = process.argv.slice(2);
    if (!file || !path.isAbsolute(file)) throw new Error('An absolute internal policy path is required');
    if (command === 'host-check') {
      checkHost(file);
      await checkGuest(file);
    } else if (command === 'guest-check') await checkGuest(file);
    else if (command === 'guest-archive' && arg) await checkGuestArchive(file, arg);
    else if (command === 'prepare' && arg && process.argv[5] === '--yes') prepare(file, arg);
    else if (command === 'protect' && arg && process.argv[5] === '--yes') protect(file, arg);
    else if (command === 'observe' && arg && process.argv[5] === '--yes') observe(file, arg);
    else if (command === 'stop' && arg === '--yes') console.log(`Stopped ${stopProject(file)} managed containers`);
    else if (command === 'down' && arg === '--yes')
      console.log(`Removed ${removeProject(file)} managed containers; volumes retained`);
    else if (command === 'override' && arg && process.argv[5]) {
      // Render privately. Only topology is persisted; never write the rendered environment/credentials.
      // Use the common Compose v2 surface: the controller may bundle an older
      // plugin than the host, without the newer --no-env-resolution flag.
      const rendered = JSON.parse(
        docker([
          'compose',
          '--project-name',
          projectName(file),
          '--project-directory',
          process.argv[5],
          '-f',
          arg,
          '--profile',
          '*',
          'config',
          '--format',
          'json'
        ])
      );
      const result = JSON.stringify(composeOverride(file, arg, rendered), null, 2);
      console.log(result);
    } else if (command === 'watch') await watch(file);
    else throw new Error('Invalid storage control command or missing --yes');
  })().catch(() => {
    console.error('Storage operation failed closed. Check disk identity, policy, monitor, and migration status.');
    process.exitCode = 1;
  });
}
