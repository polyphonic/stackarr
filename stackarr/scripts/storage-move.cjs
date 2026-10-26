#!/usr/bin/env node
'use strict';
// HOST-only Settings relocation worker. Never receive commands or environment from the guest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const control = require('./storage-control.cjs');
const migration = require('./storage-migrate.cjs');

const phases = new Set(['queued', 'planning', 'stopping', 'copying', 'starting', 'completed', 'failed']);
function directory(policyFile) {
  return path.join(path.dirname(policyFile), 'storage-move');
}
function atomic(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
function validRequest(request, now = Date.now()) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(',') !== 'destination,id,requestedAt,version' ||
    request.version !== 1 ||
    typeof request.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(request.id) ||
    typeof request.destination !== 'string' ||
    !path.isAbsolute(request.destination) ||
    path.normalize(request.destination) !== request.destination ||
    request.destination === '/' ||
    /[\0\r\n]/.test(request.destination) ||
    typeof request.requestedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(request.requestedAt) ||
    new Date(request.requestedAt).toISOString() !== request.requestedAt ||
    Math.abs(now - Date.parse(request.requestedAt)) > 120000
  )
    throw new Error('Invalid or stale relocation request');
  return request;
}
function status(policyFile, request, phase, message) {
  if (!phases.has(phase)) throw new Error('Invalid relocation phase');
  const value = {
    id: request.id,
    phase,
    destination: request.destination,
    ...(message ? { message } : {}),
    updatedAt: new Date().toISOString()
  };
  atomic(path.join(directory(policyFile), 'status.json'), value);
}
function safeFailure(error) {
  // Do not leak executable output, paths other than the requested destination, or credentials.
  if (error && error.code === 'NATIVE_WRITER')
    return 'Native configuration writer is active; stop it manually before retrying.';
  return 'Relocation stopped; original and migration journal retained. Inspect the host migration journal before recovery.';
}
function consume(
  policyFile,
  { spawn = require('node:child_process').spawn, guard = control.checkHost, now = Date.now } = {}
) {
  const dir = directory(policyFile),
    incoming = path.join(dir, 'request.json'),
    active = path.join(dir, 'active.json');
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink() || !fs.existsSync(incoming)) return false;
  if (fs.existsSync(active)) return false; // Never replay after monitor restart.
  const claim = path.join(dir, 'consume.lock');
  try {
    fs.mkdirSync(claim, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  let request;
  try {
    if (fs.existsSync(active)) return false;
    const stat = fs.lstatSync(incoming);
    if (!stat.isFile() || stat.size > 2048) throw new Error('Invalid request file');
    // Exclusive API publication briefly has a temporary hard link. Wait for
    // publication to finish instead of deleting a valid in-flight request.
    if (stat.nlink !== 1) return false;
    request = validRequest(JSON.parse(fs.readFileSync(incoming, 'utf8')), now());
    if (fs.existsSync(path.join(dir, 'status.json'))) throw new Error('Previous relocation requires host review');
    if (!fs.existsSync(path.join(path.dirname(policyFile), 'storage-enrollment.json')))
      throw new Error('External storage guard is not enrolled');
    guard(policyFile); // Fresh physical host check before accepting work.
    fs.renameSync(incoming, active);
    status(policyFile, request, 'queued');
    const child = spawn(process.execPath, [__filename, 'work', policyFile], {
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    child.on('error', () => status(policyFile, request, 'failed', 'Host worker could not start.'));
    child.unref();
    return true;
  } catch (error) {
    // Invalid input never reaches execution. Keep a safe status for recovered guests.
    if (request) status(policyFile, request, 'failed', safeFailure(error));
    fs.rmSync(incoming, { force: true });
    return false;
  } finally {
    fs.rmdirSync(claim);
  }
}
function command(file, args, env) {
  return execFileSync(file, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 4 * 60 * 60 * 1000,
    maxBuffer: 1024 * 1024
  });
}
function nativeWriters(source, run = command, phase = 'stopped') {
  // Tdarr's native node has no Stackarr-scoped stop operation. Refuse rather than kill a shared process.
  const listing = run('/bin/ps', ['-axo', 'pid=,command='], process.env);
  if (listing.split('\n').some((line) => /(?:Tdarr_Node|TdarrNode|tdarr_node)(?:\s|$)/i.test(line))) {
    const error = new Error('Native Tdarr worker active');
    error.code = 'NATIVE_WRITER';
    throw error;
  }
  if (phase === 'preflight') return;
  // Scan after Docker consumers are removed. Their VM file-sharing process
  // legitimately holds writable handles during preflight.
  const lsof = ['/usr/sbin/lsof', '/usr/bin/lsof'].find((candidate) => fs.existsSync(candidate));
  if (!lsof) throw new Error('Cannot verify native configuration writers');
  let output;
  try {
    output = run(lsof, ['-nP', '-Fpa', '+D', source], process.env);
  } catch (error) {
    // lsof can return 1 with matching records. Still inspect those records.
    if (error.status !== 1 || String(error.stderr || '').trim()) throw error;
    output = String(error.stdout || '');
  }
  if (output.split('\n').some((line) => line === 'aw' || line === 'au')) {
    const error = new Error('Native writer active');
    error.code = 'NATIVE_WRITER';
    throw error;
  }
}
function work(
  policyFile,
  { run = command, guard = control.checkHost, engine = migration.createEngine(), writers = nativeWriters } = {}
) {
  const dir = directory(policyFile),
    active = path.join(dir, 'active.json');
  const request = JSON.parse(fs.readFileSync(active, 'utf8'));
  const root = path.resolve(__dirname, '..');
  const common = path.join(root, 'lib/common.sh');
  const journal = path.join(path.dirname(policyFile), 'storage-migration.json');
  try {
    validRequest(request);
    guard(policyFile);
    status(policyFile, request, 'planning');
    // This supported loader reads authoritative controller/DB runtime values while available.
    // Keep them only in worker memory: never persist credentials in queue or status.
    const stateRoot = path.dirname(policyFile);
    const composeEnv = path.join(stateRoot, 'compose/.env');
    if (!fs.existsSync(composeEnv) || !fs.statSync(composeEnv).isFile())
      throw new Error('Installed runtime environment is unavailable');
    // The monitor service carries only a policy path, not installation roots.
    // Bootstrap from the internal installed Compose env, never the policy's grandparent
    // or incidental environment inherited by the host worker.
    const bootstrap = { ...process.env };
    delete bootstrap.APP_ROOT;
    delete bootstrap.CONFIG_ROOT;
    delete bootstrap.STATE_ROOT;
    delete bootstrap.STACKARR_COMPOSE_PROJECT_DIR;
    delete bootstrap.STACKARR_COMPOSE_ENV_FILE;
    const env = JSON.parse(
      run(
        '/bin/bash',
        [
          '-c',
          'source "$1"; load_compose_runtime_env; [[ -n "${APP_ROOT:-}" && -n "${CONFIG_ROOT:-}" && "${STATE_ROOT:-}" == "$2" ]] || exit 1; load_env >/dev/null; if database_mode_is_postgres; then load_postgres_runtime_config >/dev/null || exit 1; fi; node -e "process.stdout.write(JSON.stringify(process.env))"',
          'storage-move',
          common,
          stateRoot
        ],
        {
          ...bootstrap,
          STACKARR_COMPOSE_ENV_FILE: composeEnv,
          STACKARR_STORAGE_POLICY: policyFile
        }
      )
    );
    if (
      !env.APP_ROOT ||
      !path.isAbsolute(env.APP_ROOT) ||
      !env.CONFIG_ROOT ||
      !path.isAbsolute(env.CONFIG_ROOT) ||
      env.STATE_ROOT !== stateRoot ||
      env.STACKARR_STORAGE_POLICY !== policyFile
    )
      throw new Error('Authoritative runtime is unavailable');
    const source = env.CONFIG_ROOT;
    const project = JSON.parse(fs.readFileSync(policyFile, 'utf8')).project || 'stackarr';
    if ((env.COMPOSE_PROJECT_NAME || 'stackarr') !== project)
      throw new Error('Runtime and enrolled Compose projects do not match');
    if (fs.existsSync(journal)) throw new Error('Previous migration journal requires host review');
    if (
      fs.existsSync(request.destination) ||
      !fs.existsSync(path.dirname(request.destination)) ||
      fs.lstatSync(path.dirname(request.destination)).isSymbolicLink()
    )
      throw new Error('Destination must be absent with a real existing parent');
    engine.plan(source, request.destination, journal, policyFile); // Before downtime.
    engine.preflight(source, request.destination, project);
    writers(source, run, 'preflight');
    status(policyFile, request, 'stopping');
    // Pass the exact enrolled policy. A wrapper that re-derives the default
    // app root could stop a different installation when custom paths are used.
    run(process.execPath, [path.join(root, 'scripts/storage-control.cjs'), 'down', policyFile, '--yes'], env);
    writers(source, run, 'stopped');

    status(policyFile, request, 'copying');
    engine.run(source, request.destination, journal, policyFile);
    status(policyFile, request, 'starting');
    // Reuse the already generated Compose topology and captured authoritative settings.
    // No configure, runtime-env rewrite, or general up (which may reconcile preferences).
    run(
      '/bin/bash',
      [
        '-c',
        'set -euo pipefail; source "$1"; dir="$(stackarr_compose_project_dir)"; file="$(stackarr_compose_file)"; [[ -f "$file" && -f "$dir/storage-override.json" ]] || exit 1; args=(); while IFS= read -r arg; do args+=("$arg"); done < <(compose_profile_args); stackarr_storage_guard; docker compose --project-name "${COMPOSE_PROJECT_NAME:-stackarr}" --project-directory "$dir" -f "$file" -f "$dir/storage-override.json" "${args[@]}" up -d --remove-orphans',
        'storage-move',
        common
      ],
      env
    );
    status(policyFile, request, 'completed');
    return true;
  } catch (error) {
    status(policyFile, request, 'failed', safeFailure(error));
    // Never rollback automatically: after cutover the new destination may have accepted writes.
    // If stop succeeded, leave all state for explicit recovery; no generic restart bypassing the guard.
    return false;
  }
}
module.exports = { directory, validRequest, consume, work, nativeWriters };
if (require.main === module) {
  try {
    if (process.argv[2] !== 'work' || !path.isAbsolute(process.argv[3])) throw new Error('Invalid invocation');
    if (!work(process.argv[3])) process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  }
}
