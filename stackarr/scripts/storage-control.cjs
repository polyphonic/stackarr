#!/usr/bin/env node
// Host-owned safety coordination. This is an availability guard, not a security boundary.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
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
// Capacity queries are restricted to the enrolled roots (or the internal
// control-state directory). Never accept a caller-chosen host filesystem path.
function usageForRoot(file, requested, run = execFileSync) {
  const roots = policy.readPolicy(file).roots;
  const state = path.dirname(file);
  const record = roots.find((entry) => entry.path === requested);
  if (requested !== state && !record) throw new Error('Unenrolled capacity path');
  const target = record ? record.realPath : state;
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
  return {
    filesystem: match[1],
    totalKilobytes: Number(match[2]),
    availableKilobytes: Number(match[3]),
    usedPercent: Number(match[4]),
    mountPoint: match[5]
  };
}
function respond(file, check = checkHost, now = Date.now) {
  const dir = bridgeDir(file);
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) throw new Error('Storage bridge is unavailable');
  for (const name of fs.readdirSync(dir).slice(0, 256)) {
    if (!/^[a-f0-9]{32}\.(request|response)$/.test(name)) continue;
    const entry = path.join(dir, name);
    const stat = fs.lstatSync(entry);
    if (!stat.isFile()) continue;
    if (now() - stat.mtimeMs > 30000) {
      fs.unlinkSync(entry);
      continue;
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
      let ready = false;
      try {
        check(file);
        ready = true;
      } catch {
        /* Fail closed without leaking OS errors. */
      }
      let usage;
      if (ready && request.operation === 'usage') {
        try {
          usage = usageForRoot(file, request.path);
        } catch {
          ready = false;
        }
      } else if (request.operation !== undefined) ready = false;
      atomic(path.join(dir, `${nonce}.response`), {
        nonce,
        digest: request.digest,
        ready,
        at: now(),
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
  if (!services.app || !services['app-updater']) throw new Error('Unrecognized Compose service layout');
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
  for (const name of ['app', 'app-updater']) {
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
  checkHost,
  checkGuest,
  prepare,
  protect,
  stopProject,
  removeProject,
  respond,
  composeOverride,
  bridgeDir,
  usageForRoot
};
if (require.main === module) {
  (async () => {
    const [command, file, arg] = process.argv.slice(2);
    if (!file || !path.isAbsolute(file)) throw new Error('An absolute internal policy path is required');
    if (command === 'host-check') {
      checkHost(file);
      await checkGuest(file);
    } else if (command === 'guest-check') await checkGuest(file);
    else if (command === 'prepare' && arg && process.argv[5] === '--yes') prepare(file, arg);
    else if (command === 'protect' && arg && process.argv[5] === '--yes') protect(file, arg);
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
