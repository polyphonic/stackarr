#!/usr/bin/env node
'use strict';

// Host-side volume identity only. Run on native macOS or Linux, never in a Docker guest.
// Windows is unsupported; WSL is supported only as native Linux with a real Linux mount.
const fs = require('node:fs');

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const SUPPORTED = new Set(['apfs', 'hfs', 'hfs+', 'ext4', 'xfs', 'btrfs', 'zfs']);

function absolute(input) {
  if (
    typeof input !== 'string' ||
    !path.isAbsolute(input) ||
    input.includes('\0') ||
    input.split(path.sep).some((part) => part === '.' || part === '..')
  ) {
    throw new Error('storage root must be an absolute path without traversal');
  }
  return path.resolve(input);
}

function within(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function physicalPath(resolved, mountPoint) {
  if (within(resolved, mountPoint)) return resolved;
  // Data-volume firmlinks retain logical /Users and /private paths. Accept
  // this alias only when the kernel confirms matching device AND inode.
  if (process.platform === 'darwin' && mountPoint === '/System/Volumes/Data') {
    const candidate = path.join(mountPoint, resolved);
    const a = fs.statSync(resolved);
    const b = fs.statSync(candidate);
    if (a.dev === b.dev && a.ino === b.ino) return candidate;
  }
  throw new Error('path does not belong to reported mount');
}

function macPlist(xml) {
  // diskutil -plist emits flat XML dictionary values for these volume attributes.
  const result = {};
  for (const [, key, string, boolean] of xml.matchAll(
    /<key>([^<]+)<\/key>\s*(?:<string>([^<]*)<\/string>|<(true|false)\s*\/>)/g
  )) {
    result[key] = boolean
      ? boolean === 'true'
      : string
          .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
  }
  return result;
}

function hostProbe(target) {
  if (process.platform === 'darwin') {
    // diskutil accepts volume mount points, not arbitrary descendants.
    // df -P asks the kernel which mounted filesystem owns the resolved path.
    const df = execFileSync('/bin/df', ['-P', target], { encoding: 'utf8', timeout: 5000 }).trim().split('\n');
    const match = df.at(-1)?.match(/\s+\d+%\s+(.+)$/);
    if (!match) throw new Error('df did not return a mounted filesystem');
    const mountPoint = match[1];
    const info = macPlist(
      execFileSync('/usr/sbin/diskutil', ['info', '-plist', mountPoint], { encoding: 'utf8', timeout: 5000 })
    );
    if (!info.MountPoint || info.MountPoint !== mountPoint || !info.VolumeUUID || !info.FilesystemType) {
      throw new Error('diskutil did not return a matching mounted volume identity');
    }
    return {
      mountPoint,
      uuid: info.VolumeUUID,
      filesystem: info.FilesystemType,
      readOnly: info.WritableVolume !== true
    };
  }
  if (process.platform === 'linux') {
    if (
      fs.existsSync('/.dockerenv') ||
      fs.existsSync('/run/.containerenv') ||
      /(?:docker|containerd|kubepods|libpod)/i.test(fs.readFileSync('/proc/1/cgroup', 'utf8')) ||
      /(?:^|\s)(?:overlay|fuse\.overlayfs)\s/.test(
        fs
          .readFileSync('/proc/self/mountinfo', 'utf8')
          .split('\n')
          .find((line) => line.split(' ')[4] === '/') || ''
      )
    ) {
      throw new Error('volume identity must be checked on the host, not inside a container');
    }
    const data = JSON.parse(
      execFileSync('findmnt', ['--json', '--target', target, '--output', 'TARGET,UUID,FSTYPE,OPTIONS,SOURCE'], {
        encoding: 'utf8',
        timeout: 5000
      })
    );
    const row = data.filesystems?.[0];
    if (!row || !row.uuid || !row.target || !row.fstype)
      throw new Error('findmnt did not return a mounted volume UUID');
    return {
      mountPoint: row.target,
      uuid: row.uuid,
      filesystem: row.fstype,
      readOnly: String(row.options || '')
        .split(',')
        .includes('ro')
    };
  }
  throw new Error('volume inspection is supported only on native macOS and Linux (including native WSL Linux mounts)');
}

function inspectVolume(absolutePath, options = {}) {
  const target = absolute(absolutePath);
  const resolved = fs.realpathSync(target);
  const probe = options.probe || hostProbe;
  const volume = probe(resolved);
  if (
    !volume ||
    typeof volume.mountPoint !== 'string' ||
    typeof volume.uuid !== 'string' ||
    !volume.uuid ||
    typeof volume.filesystem !== 'string' ||
    typeof volume.readOnly !== 'boolean'
  ) {
    throw new Error('incomplete volume identity');
  }
  const mountPoint = absolute(volume.mountPoint);
  physicalPath(resolved, mountPoint);
  if (!SUPPORTED.has(volume.filesystem.toLowerCase())) throw new Error('unsupported application-state filesystem');
  return { mountPoint, uuid: volume.uuid, filesystem: volume.filesystem.toLowerCase(), readOnly: volume.readOnly };
}

function locate(input, allowMissingLeaf) {
  const target = absolute(input);
  try {
    return { path: target, realPath: fs.realpathSync(target), anchor: target };
  } catch (error) {
    if (!allowMissingLeaf || error.code !== 'ENOENT') throw error;
    try {
      fs.lstatSync(target);
      throw new Error('Dangling storage root');
    } catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
    }
    const parent = path.dirname(target);
    const realParent = fs.realpathSync(parent); // No recursive missing descendants.
    if (!fs.statSync(parent).isDirectory()) throw new Error('missing leaf parent is not a directory');
    return { path: target, realPath: path.join(realParent, path.basename(target)), anchor: parent };
  }
}

function captureRoot(absolutePath, options = {}) {
  const root = locate(absolutePath, options.allowMissingLeaf === true);
  const volume = inspectVolume(root.anchor, options);
  if (volume.readOnly) throw new Error('volume is read-only');
  const anchor = physicalPath(fs.realpathSync(root.anchor), volume.mountPoint);
  root.realPath =
    options.allowMissingLeaf && !fs.existsSync(root.path)
      ? path.join(anchor, path.basename(root.path))
      : physicalPath(root.realPath, volume.mountPoint);
  return {
    path: root.path,
    realPath: root.realPath,
    mountPoint: volume.mountPoint,
    uuid: volume.uuid,
    filesystem: volume.filesystem
  };
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid storage root record');
  for (const key of ['path', 'realPath', 'mountPoint']) {
    if (typeof record[key] !== 'string' || absolute(record[key]) !== record[key]) throw new Error(`invalid ${key}`);
  }
  if (
    !record.uuid ||
    typeof record.uuid !== 'string' ||
    !record.filesystem ||
    typeof record.filesystem !== 'string' ||
    !within(record.realPath, record.mountPoint)
  )
    throw new Error('invalid storage root identity');
}

function verifyRoot(record, options = {}) {
  validateRecord(record);
  const current = captureRoot(record.path, options);
  if (current.realPath !== record.realPath) throw new Error('storage root symlink retargeted');
  if (
    current.mountPoint !== record.mountPoint ||
    current.uuid !== record.uuid ||
    current.filesystem !== record.filesystem
  ) {
    throw new Error('storage root volume identity changed or mount unavailable');
  }
  return current;
}

function validatePolicy(policy) {
  if (!policy || policy.version !== 1 || !Array.isArray(policy.roots))
    throw new Error('invalid storage policy version or roots');
  if (
    Object.hasOwn(policy, 'project') &&
    (typeof policy.project !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(policy.project))
  ) {
    throw new Error('invalid storage policy project');
  }
  for (const root of policy.roots) validateRecord(root);
  return policy;
}

function readPolicy(policyFile) {
  const filename = absolute(policyFile);
  let data;
  try {
    data = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, roots: [] };
    throw error;
  }
  return validatePolicy(JSON.parse(data));
}

function checkPolicy(policyFile, options = {}) {
  const policy = readPolicy(policyFile);
  for (const root of policy.roots) verifyRoot(root, options);
  return policy;
}

function writePolicy(policyFile, policy) {
  const filename = absolute(policyFile);
  validatePolicy(policy);
  const tmp = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${crypto.randomBytes(12).toString('hex')}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(policy, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filename);
    const directory = fs.openSync(path.dirname(filename), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(tmp);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = { inspectVolume, captureRoot, verifyRoot, readPolicy, checkPolicy, writePolicy };

if (require.main === module) {
  try {
    const [action, target, extra] = process.argv.slice(2);
    if (extra || !target || !['inspect', 'check'].includes(action)) {
      throw new Error('usage: storage-policy.cjs inspect ABSOLUTE_PATH | check POLICYFILE');
    }
    if (action === 'inspect') console.log(JSON.stringify(inspectVolume(target)));
    else {
      checkPolicy(target);
      console.log('storage policy safe');
    }
  } catch (error) {
    console.error(`storage policy unsafe: ${error.message}`);
    process.exitCode = 1;
  }
}
