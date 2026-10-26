import fs from 'node:fs';
import path from 'node:path';

/** Validate the saved host path without claiming that a Docker guest can attest a host mount. */
export function validateTorrentArchiveRoot(
  requested: unknown,
  current: string | undefined,
  roots: { config: string; state: string; logs: string; backup: string; staging: string },
  policyFile?: string
): string | null {
  // Other storage roots can change even when this field is omitted or unchanged.
  // Always validate the effective archive against the proposed root set.
  const effective = requested === undefined ? current || path.join(roots.state, 'torrent-archive') : requested;
  if (
    typeof effective !== 'string' ||
    !effective ||
    !path.isAbsolute(effective) ||
    /[\0\r\n:]/.test(effective) ||
    effective.split('/').some((part) => part === '.' || part === '..') ||
    path.normalize(effective) !== effective ||
    effective.endsWith('/')
  ) {
    return 'Torrent archive root must be an absolute host path without traversal or Compose separators.';
  }
  const candidate = effective;
  const inside = (child: string, parent: string) => child === parent || child.startsWith(`${parent}/`);
  // Mirror the host guard's projection through existing managed-root ancestors.
  // This is a pre-save check, not a substitute for host mount attestation at apply.
  const physical = (input: string): string => {
    let ancestor = input;
    while (true) {
      try {
        fs.lstatSync(ancestor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || ancestor === '/') throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    return path.join(fs.realpathSync(ancestor), path.relative(ancestor, input));
  };
  let targetPhysical: string;
  try {
    targetPhysical = physical(candidate);
  } catch {
    return 'Torrent archive root cannot be inspected.';
  }
  const defaultArchive = path.join(roots.state, 'torrent-archive');
  let isDefault = candidate === defaultArchive;
  if (isDefault) {
    try {
      isDefault = targetPhysical === path.join(physical(roots.state), 'torrent-archive');
    } catch {
      return 'Torrent archive state root cannot be inspected.';
    }
  }
  for (const [name, root] of Object.entries(roots)) {
    if (!root || !path.isAbsolute(root)) return `Torrent archive ${name} root is unavailable.`;
    let managedPhysical: string;
    try {
      managedPhysical = physical(root);
    } catch {
      return `Torrent archive ${name} root cannot be inspected.`;
    }
    if (
      (!isDefault || name !== 'state') &&
      (inside(root, candidate) ||
        inside(candidate, root) ||
        inside(managedPhysical, targetPhysical) ||
        inside(targetPhysical, managedPhysical))
    ) {
      return `Torrent archive root must not overlap the ${name} root.`;
    }
  }
  if (inside(candidate, '/Volumes')) {
    try {
      if (!policyFile || fs.lstatSync(policyFile).isSymbolicLink()) throw new Error('missing policy');
      const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8')) as { roots?: Array<{ path?: string }> };
      if (
        !Array.isArray(policy.roots) ||
        !policy.roots.some(
          (root) => typeof root.path === 'string' && root.path.startsWith('/Volumes/') && inside(candidate, root.path)
        )
      )
        throw new Error('not enrolled');
    } catch {
      return 'External torrent archive root must be under an enrolled storage policy root; verify the host mount before apply.';
    }
  }
  // Existing ancestors must not redirect the requested path through a symlink.
  // The host-side storage guard still verifies actual mount identity at apply time.
  let ancestor = candidate;
  while (ancestor !== '/') {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) return 'Torrent archive root must not contain symlink ancestors.';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'Torrent archive root cannot be inspected.';
    }
    ancestor = path.dirname(ancestor);
  }
  return null;
}
