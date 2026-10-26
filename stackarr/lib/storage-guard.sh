#!/bin/bash
# Loaded by common.sh. No probing or writes until a caller explicitly runs a guard.
stackarr_storage_policy_file() {
    local state_root="${STATE_ROOT:-${APP_ROOT:-$(default_app_root)}/state}"
    printf '%s\n' "${STACKARR_STORAGE_POLICY:-$state_root/storage-policy.json}"
}

stackarr_storage_guard() {
    local policy
    policy="$(stackarr_storage_policy_file)"
    if [[ -z "${STACKARR_STORAGE_POLICY:-}" && ! -e "$policy" && ! -L "$policy" && ! -e "${policy%/*}/storage-enrollment.json" && ! -L "${policy%/*}/storage-enrollment.json" && ! -e "${policy%/*}/storage-migration.json" && ! -L "${policy%/*}/storage-migration.json" ]]; then
        return 0
    fi
    [[ -f "$policy" && ! -L "$policy" ]] || fail 'External storage policy is unavailable; refusing an unguarded operation'
    export STACKARR_STORAGE_POLICY="$policy"
    require_command node
    if stackarr_runtime_is_container; then
        node "$ROOT_DIR/scripts/storage-control.cjs" guest-check "$policy" || fail 'External storage host verification failed'
    else
        node "$ROOT_DIR/scripts/storage-control.cjs" host-check "$policy" || fail 'External storage identity verification failed'
    fi
}

# Validate both lexical and physical ancestry before any archive mkdir, staging or Compose.
# The standard state child is deliberately allowed; every other root must be
# disjoint from managed config/state/log/backup trees (including staging).
stackarr_verify_torrent_archive_root() {
    local root="${TORRENT_ARCHIVE_ROOT:-${STATE_ROOT:-$(default_app_root)/state}/torrent-archive}"
    require_command node
    node - "$root" "${CONFIG_ROOT:-${APP_ROOT:-$(default_app_root)}/config}" \
        "${STATE_ROOT:-${APP_ROOT:-$(default_app_root)}/state}" \
        "${LOG_ROOT:-${APP_ROOT:-$(default_app_root)}/logs}" \
        "${BACKUP_ROOT:-${APP_ROOT:-$(default_app_root)}/backups}" \
        "${BACKUP_STAGING_ROOT:-${BACKUP_ROOT:-${APP_ROOT:-$(default_app_root)}/backups}/.stackarr-staging}" \
        "${STACKARR_STORAGE_POLICY:-}" <<'NODE' || fail 'Unsafe or unenrolled TORRENT_ARCHIVE_ROOT'
const fs = require('node:fs');
const path = require('node:path');
const [archive, config, state, logs, backup, staging, policyFile] = process.argv.slice(2);
const inside = (child, parent) => child === parent || child.startsWith(`${parent}/`);
function canonical(input, managed = false) {
  if (!input.startsWith('/') || input.includes('\0') ||
      input.split('/').some(part => part === '.' || part === '..') ||
      path.normalize(input) !== input || input.endsWith('/') || input === '/') throw Error('noncanonical root');
  let anchor = input;
  while (true) {
    try { fs.lstatSync(anchor); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || anchor === '/') throw error;
      anchor = path.dirname(anchor);
    }
  }
  if (!fs.statSync(anchor).isDirectory()) throw Error('non-directory ancestor');
  const physical = path.join(fs.realpathSync(anchor), path.relative(anchor, input));
  // A dangling final symlink is not a missing directory.
  if (!managed && anchor === input && fs.lstatSync(input).isSymbolicLink()) throw Error('symlink root');
  return { lexical: input, physical, anchor };
}
try {
  const target = canonical(archive);
  // Resolve approved managed-root symlinks, but reject symlink archive roots.
  const managed = [config, state, logs, backup, staging].map(input => canonical(input, true));
  const [cfg, st, log, bak, stage] = managed;
  const defaultArchive = path.join(st.physical, 'torrent-archive');
  const isDefault = target.physical === defaultArchive &&
    target.lexical === path.join(st.lexical, 'torrent-archive');
  // The default is valid only if it does not alias another managed tree.
  for (const protectedRoot of [cfg, log, bak, stage]) {
    if (inside(target.physical, protectedRoot.physical) ||
        inside(protectedRoot.physical, target.physical)) throw Error('managed tree overlap');
  }
  if (!isDefault && (inside(target.physical, st.physical) ||
                     inside(st.physical, target.physical))) throw Error('state overlap');
  if (target.physical === '/' || target.lexical === '/') throw Error('filesystem root');
  if (target.lexical.startsWith('/Volumes/') || target.physical.startsWith('/Volumes/')) {
    if (!policyFile) throw Error('missing enrollment');
    // Host/guest mount identity has already been verified by stackarr_storage_guard.
    const records = JSON.parse(fs.readFileSync(policyFile, 'utf8')).roots;
    if (!records.some(record =>
      inside(target.physical, record.realPath) &&
      fs.statSync(target.anchor).dev === fs.statSync(record.path).dev
    )) throw Error('unenrolled root');
  }
} catch (error) {
  console.error(`Torrent archive path validation failed: ${error.message}`);
  process.exitCode = 1;
}
NODE
}

prepare_storage_compose_override() {
    local project_dir="$1" source_file="$2" target
    [[ -n "${STACKARR_STORAGE_POLICY:-}" ]] || return 0
    target="$project_dir/storage-override.json"
    [[ "$project_dir" != "$ROOT_DIR" ]] || fail 'Guarded storage requires an installed generated Compose project'
    if ! node "$ROOT_DIR/scripts/storage-control.cjs" override "$STACKARR_STORAGE_POLICY" "$source_file" "$project_dir" > "$target.tmp.$$"; then
        rm -f "$target.tmp.$$"
        fail 'Cannot generate guarded Compose topology'
    fi
    chmod 600 "$target.tmp.$$"
    mv "$target.tmp.$$" "$target"
}
