#!/usr/bin/env node
'use strict';
// Offline CONFIG_ROOT relocation. All paths are host paths; never invoke this in a container.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
const fail = (message) => {
  throw new Error(message);
};
const inside = (a, b) => a === b || b.startsWith(`${a}${path.sep}`);
const overlap = (a, b) => inside(a, b) || inside(b, a);
const absolute = (p) => {
  if (typeof p !== 'string' || !path.isAbsolute(p) || path.normalize(p) !== p || p === '/')
    fail('An absolute, normalized non-root path is required');
  return p;
};
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, ...opts });
function atomic(file, value, exclusive = false) {
  const data = JSON.stringify(value, null, 2) + '\n';
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (exclusive && exists(file)) fail('Journal already exists');
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
  } finally {
    if (exists(tmp)) fs.unlinkSync(tmp);
  }
}
function readJournal(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    j.version !== 1 ||
    ![
      'prepared',
      'copying',
      'copied',
      'policy-registered',
      'cutover-pending',
      'completed',
      'rollback-pending',
      'rolled-back'
    ].includes(j.phase)
  )
    fail('Unknown migration journal');
  for (const p of ['source', 'destination', 'original', 'policy']) absolute(j[p]);
  return j;
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function tree(root, durable = false) {
  const entries = [];
  let bytes = 0;
  // Reuse one buffer across the synchronous traversal instead of allocating
  // a megabyte for each small file in large application configuration trees.
  const buf = Buffer.allocUnsafe(1024 * 1024);
  const rootDev = fs.lstatSync(root).dev;
  const rootStat = fs.lstatSync(root);

  entries.push({ path: '.', type: 'directory', mode: rootStat.mode & 0o7777, uid: rootStat.uid, gid: rootStat.gid });
  function walk(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // Finder can rewrite folder-view metadata even with all app writers stopped.
      // Copy and retain these files, but do not treat them as application state.
      if (ent.isFile() && ent.name === '.DS_Store') continue;
      const sub = path.join(rel, ent.name),
        full = path.join(dir, ent.name),
        st = fs.lstatSync(full);
      if (st.dev !== rootDev) fail('Nested mount in configuration tree');

      const base = { path: sub, mode: st.mode & 0o7777, uid: st.uid, gid: st.gid };
      if (st.isDirectory()) {
        entries.push({ ...base, type: 'directory' });
        walk(full, sub);
      } else if (st.isFile()) {
        bytes += st.size;
        const hash = crypto.createHash('sha256');
        const fd = fs.openSync(full, 'r');
        try {
          let n;
          while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
          if (durable) fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        entries.push({
          ...base,
          type: 'file',
          size: st.size,
          sha256: hash.digest('hex'),
          hardlink: st.nlink > 1 ? `${st.dev}:${st.ino}` : null
        });
      } else if (st.isSymbolicLink()) {
        const link = fs.readlinkSync(full);
        const resolved = path.resolve(path.dirname(full), link);
        if (
          path.isAbsolute(link) ||
          !inside(root, resolved) ||
          !exists(resolved) ||
          !inside(fs.realpathSync(root), fs.realpathSync(resolved))
        )
          fail('Unsafe link in configuration tree');
        entries.push({ ...base, type: 'link', link });
      } else fail('Special file in configuration tree');
    }
    if (durable) syncDirectory(dir);
  }
  walk(root, '');
  // Hard-link inode numbers differ across volumes; compare the equivalence classes instead.
  const groups = new Map();
  for (const e of entries)
    if (e.hardlink) {
      const group = groups.get(e.hardlink) || [];
      group.push(e.path);
      groups.set(e.hardlink, group);
    }
  for (const e of entries) if (e.hardlink) e.hardlink = groups.get(e.hardlink).sort().join('\0');
  return { entries, bytes, digest: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
function defaultDocker() {
  const ids = run('docker', ['ps', '-aq', '--no-trunc']).trim().split(/\s+/).filter(Boolean);
  return ids.length ? JSON.parse(run('docker', ['inspect', ...ids], { timeout: 30000 })) : [];
}
function defaultFree(p) {
  const stat = fs.statfsSync(p);
  const free = stat.bavail * stat.bsize;
  if (!Number.isSafeInteger(free)) fail('Cannot determine free space');
  return free;
}
function defaultCopy(source, destination) {
  if (process.platform === 'darwin') {
    run('ditto', ['--extattr', '--acl', '--rsrc', '-X', source, destination], {
      timeout: 60 * 60 * 1000,
      maxBuffer: 1024 * 1024
    });
    // ditto can unpack AppleDouble sidecars into native metadata and omit the
    // original ._ file. Retain those literal files too: the snapshot includes them.
    function preserveSidecars(dir, target) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const from = path.join(dir, ent.name),
          to = path.join(target, ent.name);
        if (ent.isDirectory()) preserveSidecars(from, to);
        else if (ent.isFile() && ent.name.startsWith('._')) {
          const original = fs.statSync(from);
          fs.copyFileSync(from, to);
          const copied = fs.statSync(to);
          if (original.uid !== copied.uid || original.gid !== copied.gid) fs.chownSync(to, original.uid, original.gid);
          fs.chmodSync(to, original.mode & 0o7777);
          fs.utimesSync(to, original.atime, original.mtime);
        }
      }
    }
    preserveSidecars(source, destination);
  } else {
    run('rsync', ['-aHAX', `${source}/`, `${destination}/`], { timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 });
  }
}
function createEngine({
  policy = require('./storage-policy.cjs'),
  docker = defaultDocker,
  free = defaultFree,
  copy = defaultCopy,
  hook = () => {}
} = {}) {
  function stopped(source, destination, project = 'stackarr', allowManaged = false) {
    const containers = docker();
    if (!Array.isArray(containers)) fail('Cannot enumerate running Docker containers');
    for (const c of containers) {
      // Before downtime, managed consumers will be removed by the scoped host
      // worker. Reject unmanaged consumers now, not after stopping the app.
      if (allowManaged && c.Config?.Labels?.['com.docker.compose.project'] === project) continue;
      if (c.State?.Running === true && c.Config?.Labels?.['com.docker.compose.project'] === project)
        fail('Stop every Stackarr container before migration');
      for (const m of c.Mounts || []) {
        if (m.Type !== 'bind') continue;
        if (!m.Source) fail('Unknown writable bind mount');
        const host = path.resolve(m.Source);
        let realHost;
        try {
          realHost = fs.realpathSync(host);
        } catch {
          fail('Cannot resolve writable bind mount');
        }
        const realSource = exists(source)
          ? fs.realpathSync(source)
          : path.join(fs.realpathSync(path.dirname(source)), path.basename(source));
        const realDestination = exists(destination)
          ? fs.realpathSync(destination)
          : path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
        if (
          [host, realHost].some((p) => [source, destination, realSource, realDestination].some((q) => overlap(p, q)))
        ) {
          if (!['no', ''].includes(c.HostConfig?.RestartPolicy?.Name))
            fail('Overlapping container has an automatic restart policy');
          if (c.State?.Running !== false)
            fail('Container has an overlapping writable bind mount and is not confirmed stopped');
          fail('Remove existing container with overlapping writable bind mount (stackarr down), then retry');
        }
      }
    }
  }
  function roots(source, destination) {
    const s = policy.captureRoot(source),
      d = policy.captureRoot(destination, { allowMissingLeaf: true });
    if (!s?.uuid || !d?.uuid || !s.mountPoint || !d.mountPoint) fail('Unverifiable storage identity');
    if (s.uuid === d.uuid) fail('Destination must be on a distinct external volume');
    return { source: s, destination: d };
  }
  function verify(j, missing = false) {
    if (exists(j.source) && !fs.lstatSync(j.source).isSymbolicLink())
      policy.verifyRoot(j.roots.source, { allowMissingLeaf: missing });
    else if (!exists(j.original) || fs.lstatSync(j.original).isSymbolicLink()) fail('Original configuration missing');
    policy.verifyRoot(j.roots.destination, { allowMissingLeaf: missing });
  }
  function snapshotDigest(snapshot) {
    // Normalize older interrupted journals too, without changing their recorded
    // application files or accepting any other content/permission/link difference.
    const entries = snapshot.entries.filter((e) => !(e.type === 'file' && path.basename(e.path) === '.DS_Store'));
    return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  }
  function snapshotMatch(a, b) {
    if (snapshotDigest(a) !== snapshotDigest(b))
      fail('Configuration contents/topology changed; refusing cutover or rollback');
  }
  function constraints(source, destination, journal, policyFile) {
    [source, destination, journal, policyFile].forEach(absolute);
    if (new Set([source, destination, journal, policyFile]).size !== 4 || overlap(source, destination))
      fail('Overlapping or identical migration paths');
    for (const p of [journal, policyFile])
      if (overlap(p, source) || overlap(p, destination))
        fail('Journal and policy must be outside both configuration trees');
    if (path.dirname(journal) !== path.dirname(policyFile))
      fail('Journal and policy must share an internal control directory');
    const control = policy.captureRoot(path.dirname(policyFile));
    if (control.uuid !== policy.captureRoot(source).uuid) fail('Control state must remain on the source filesystem');
    if (!fs.statSync(source).isDirectory() || fs.lstatSync(source).isSymbolicLink())
      fail('Source must be a real directory');
    if (exists(destination) || !fs.statSync(path.dirname(destination)).isDirectory())
      fail('Destination must be absent with an existing parent');
    if (exists(journal)) fail('Migration journal already exists');
    if (fs.lstatSync(path.dirname(destination)).isSymbolicLink()) fail('Destination parent must not be a link');
  }
  function plan(source, destination, journal, policyFile) {
    constraints(source, destination, journal, policyFile);
    policy.checkPolicy(policyFile);

    const identified = roots(source, destination),
      manifest = tree(source);
    if (free(path.dirname(destination)) < Math.ceil(manifest.bytes * 1.2) + 1024 * 1024)
      fail('Insufficient destination space');
    return {
      source,
      destination,
      journal,
      policy: policyFile,
      bytes: manifest.bytes,
      entries: manifest.entries.length,
      roots: identified
    };
  }
  function runMigration(source, destination, journal, policyFile) {
    stopped(source, destination, policy.readPolicy(policyFile).project);
    if (!exists(journal)) {
      const planned = plan(source, destination, journal, policyFile);
      const j = {
        version: 1,
        phase: 'prepared',
        source,
        destination,
        policy: policyFile,
        original: `${source}.stackarr-original-${crypto.randomBytes(6).toString('hex')}`,
        roots: planned.roots,
        priorPolicy: policy.readPolicy(policyFile),
        snapshot: tree(source)
      };
      if (exists(j.original)) fail('Rollback tree path occupied');
      atomic(journal, j, true);
    }
    const j = readJournal(journal);
    if (j.source !== source || j.destination !== destination || j.policy !== policyFile)
      fail('Journal arguments mismatch');
    if (j.phase === 'completed') {
      verify(j);
      if (!fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== j.roots.destination.realPath)
        fail('Active link missing');
      policy.checkPolicy(policyFile);
      return j;
    }
    if (['rollback-pending', 'rolled-back'].includes(j.phase)) fail('Migration is being rolled back');
    stopped(source, destination, j.priorPolicy.project);
    verify(j, true);
    if (['prepared', 'copying'].includes(j.phase)) {
      if (!exists(source) || fs.lstatSync(source).isSymbolicLink()) fail('Source missing during copy');
      snapshotMatch(j.snapshot, tree(source));
      // Reuse a complete interrupted copy only after full hash/topology verification
      // and flushing. Never trust size, timestamps, or the previous phase alone.
      const reusable = exists(destination) && snapshotDigest(j.snapshot) === snapshotDigest(tree(destination, true));
      if (!exists(destination)) fs.mkdirSync(destination, { mode: fs.statSync(source).mode & 0o7777 });
      j.phase = 'copying';
      atomic(journal, j);
      hook('copying');
      if (!reusable) copy(source, destination);
      // Copy tools can preserve children while leaving an existing root's
      // metadata unchanged (including mkdir's umask). Match it explicitly.
      const sourceRoot = fs.statSync(source);
      const destinationRoot = fs.statSync(destination);
      if (sourceRoot.uid !== destinationRoot.uid || sourceRoot.gid !== destinationRoot.gid)
        fs.chownSync(destination, sourceRoot.uid, sourceRoot.gid);
      fs.chmodSync(destination, sourceRoot.mode & 0o7777);
      snapshotMatch(j.snapshot, tree(source));
      snapshotMatch(j.snapshot, tree(destination, true));
      syncDirectory(path.dirname(destination));
      j.phase = 'copied';
      atomic(journal, j);
      hook('copied');
    }
    if (j.phase === 'copied') {
      snapshotMatch(j.snapshot, tree(source));
      snapshotMatch(j.snapshot, tree(destination));
      verify(j);
      // Register the guard before replacing the logical CONFIG_ROOT. A crash leaves a guarded policy.
      const protectedRoot = { ...j.roots.destination, path: source };
      policy.writePolicy(policyFile, {
        ...j.priorPolicy,
        roots: [...j.priorPolicy.roots.filter((r) => r.path !== source), protectedRoot],
        migration: { journal, original: j.original }
      });
      j.phase = 'policy-registered';
      atomic(journal, j);
      hook('policy-registered');
    }
    if (['policy-registered', 'cutover-pending'].includes(j.phase)) {
      stopped(source, destination, j.priorPolicy.project);
      verify(j);
      snapshotMatch(j.snapshot, tree(destination));
      if (exists(source) && !fs.lstatSync(source).isSymbolicLink()) snapshotMatch(j.snapshot, tree(source));
      j.phase = 'cutover-pending';
      atomic(journal, j);
      hook('cutover-pending');
      if (!exists(j.original)) {
        if (!exists(source) || fs.lstatSync(source).isSymbolicLink()) fail('Original configuration disappeared');
        fs.renameSync(source, j.original);
        syncDirectory(path.dirname(source));
      }
      if (!exists(source)) fs.symlinkSync(destination, source, 'dir');
      syncDirectory(path.dirname(source));
      if (!fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== j.roots.destination.realPath)
        fail('Unexpected path at logical configuration root');
      snapshotMatch(j.snapshot, tree(j.original));
      snapshotMatch(j.snapshot, tree(destination));
      policy.checkPolicy(policyFile);
      j.phase = 'completed';
      atomic(journal, j);
      hook('completed');
    }
    return j;
  }
  function rollback(journal, policyFile) {
    const j = readJournal(journal);
    if (j.policy === policyFile && ['prepared', 'copying', 'copied', 'policy-registered'].includes(j.phase)) {
      stopped(j.source, j.destination, j.priorPolicy.project);
      policy.verifyRoot(j.roots.source);
      if (!exists(j.source) || fs.lstatSync(j.source).isSymbolicLink()) fail('Original source is unavailable');
      snapshotMatch(j.snapshot, tree(j.source));
      policy.writePolicy(policyFile, j.priorPolicy);
      j.phase = 'rolled-back';
      atomic(journal, j);
      return j; // Partial destination remains untouched for inspection/recovery.
    }
    if (j.policy !== policyFile || !['completed', 'rollback-pending'].includes(j.phase))
      fail('Not an active migration for this policy');
    stopped(j.source, j.destination, j.priorPolicy.project);
    verify(j);
    if (
      j.phase === 'rollback-pending' &&
      !exists(j.original) &&
      exists(j.source) &&
      !fs.lstatSync(j.source).isSymbolicLink()
    ) {
      snapshotMatch(j.snapshot, tree(j.source));
      snapshotMatch(j.snapshot, tree(j.destination));
      policy.writePolicy(policyFile, j.priorPolicy);
      j.phase = 'rolled-back';
      atomic(journal, j);
      return j;
    }
    if (!exists(j.original) || !fs.statSync(j.original).isDirectory() || fs.lstatSync(j.original).isSymbolicLink())
      fail('Retained original missing');
    snapshotMatch(j.snapshot, tree(j.original));
    snapshotMatch(j.snapshot, tree(j.destination)); // Never discard writes made after cutover.
    if (
      exists(j.source) &&
      (!fs.lstatSync(j.source).isSymbolicLink() || fs.realpathSync(j.source) !== j.roots.destination.realPath)
    )
      fail('Logical path no longer points to destination');
    if (!exists(j.source) && j.phase !== 'rollback-pending') fail('Logical path missing before rollback');
    j.phase = 'rollback-pending';
    atomic(journal, j);
    hook('rollback-pending');
    if (exists(j.source)) fs.unlinkSync(j.source);
    fs.renameSync(j.original, j.source);
    syncDirectory(path.dirname(j.source));
    policy.writePolicy(policyFile, j.priorPolicy);
    j.phase = 'rolled-back';
    atomic(journal, j);
    return j;
  }
  function locked(journal, operation) {
    const lock = `${journal}.lock`;
    if (exists(lock)) {
      if (fs.lstatSync(lock).isSymbolicLink()) fail('Invalid migration lock');
      const owner = Number(fs.readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(owner) || owner < 1) fail('Invalid migration lock owner');
      try {
        process.kill(owner, 0);
        fail('Migration already active');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      fs.unlinkSync(lock);
    }
    const fd = fs.openSync(lock, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, String(process.pid));
      fs.fsyncSync(fd);
      return operation();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
  return {
    plan,
    preflight: (source, destination, project) => stopped(source, destination, project, true),
    run: (source, destination, journal, policyFile) =>
      locked(journal, () => runMigration(source, destination, journal, policyFile)),
    rollback: (journal, policyFile) => locked(journal, () => rollback(journal, policyFile))
  };
}
const usage =
  'Usage: storage-migrate.cjs plan SOURCE DEST JOURNAL POLICY\n       storage-migrate.cjs run SOURCE DEST JOURNAL POLICY --yes\n       storage-migrate.cjs rollback JOURNAL POLICY --yes\nAll Stackarr and other writable config consumers must be stopped; keep them stopped until completion. No automatic restart.\n';
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === '--help' || command === 'help') {
      process.stdout.write(usage);
      process.exit(0);
    }
    const engine = createEngine();
    let result;
    if (command === 'plan' && args.length === 4) result = engine.plan(...args);
    else if (command === 'run' && args.length === 5 && args[4] === '--yes') result = engine.run(...args.slice(0, 4));
    else if (command === 'rollback' && args.length === 3 && args[2] === '--yes')
      result = engine.rollback(...args.slice(0, 2));
    else {
      process.stderr.write(usage);
      process.exit(2);
    }
    process.stdout.write(
      JSON.stringify({
        phase: result.phase || 'planned',
        source: result.source,
        destination: result.destination,
        journal: result.journal || args[0],
        bytes: result.bytes
      }) + '\n'
    );
  } catch (e) {
    process.stderr.write(`Storage migration refused: ${e.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { createEngine, tree };
