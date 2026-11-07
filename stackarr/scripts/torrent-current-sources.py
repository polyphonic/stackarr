#!/usr/bin/env python3
"""Controller-only, stdlib current-source reconciler (no Arr API or hook calls).

Snapshot JSON v1 is ONE complete (service, instance, arrItemId) scope:
  schemaVersion: 1; service: sonarr|radarr; instance: explicit nonempty
  instance identifier (sonarr and sonarr4k are distinct); arrItemId: string;
  sequence: strictly increasing positive integer PER SCOPE, durably assigned by
  the collector, never derived from event time; available, complete,
  inventoryComplete, importsComplete: true only after successful full enumeration
  and confirmation no source pack has pending/unimported library candidates;
  currentFiles: ALL extant library files for this item, each {arrFileId,
  importedPath, mediaPath, mediaIdentity:{dev,ino,size,mtimeNs},
  downloadHash: uppercase/lowercase 40/64 hex or null}. mediaPath is a
  controller-visible canonical absolute regular file (hardlinks allowed; no symlinks at any
  ancestor); identity fields are nonnegative integers from os.stat. Null hash
  is unknown, NOT absent. Duplicates, missing or changing media block.
  inventoryStable:true asserts a fresh API rescan at apply time found no
  added/unlisted library files or archive sources; the engine cannot query Arr.
  archiveSources: COMPLETE inventory for this scope, each {path, instance,
  hash, sha256, sidecarPath, sidecarSha256}; paths are lexical archive-relative paths, hashes
  are actual torrent infohashes, digests are lowercase SHA256 of exact bytes.
  For dry-run only, a missing sidecar may be represented by proposedSidecar:
  a dict whose canonical JSON bytes (sorted keys, compact separators, newline)
  must match sidecarSha256; apply always requires real on-disk provenance.

Collector MUST bind each download hash to exact successful import event data.fileId
matching the current Arr file ID AND canonical path; ambiguous/conflicting
history stays unknown. Re-read native API inventory immediately before apply,
including pending triggers, to set inventoryStable; triggers are not source
proof. Collector MUST include unresolved imports/pack files, report API errors by
available:false, never assign an older sequence to a newer library state, and
must not claim completeness if ownership of ANY current file is unknown. The
engine does not infer ownership from filename, quality, timestamps or legacy
first-import sidecars. A missing archive for a known current hash blocks ALL
retirement. Every listed source is independently byte/infohash/provenance
verified before any writes. No snapshot grants proof of unlisted archive files:
collector owns complete inventory assertion. Retirement requires at least one
current, archived replacement and moves exact torrent + sidecar to a separately
configured root; no deletion. Roots may overlap only when retired is the
archive's exact private .retired child (excluded from source inventory).
The retired root and archive must be on the same filesystem for exclusive
no-clobber destination publication; a crash between link and source unlink
fails closed (requires manual review).
Only this controller should write these roots during apply; the flock serializes
this engine, not unrelated hook writers. Retain external backup before applying.

Schema 2 sidecars retain historical fields and add instance, currentReferences
and importedFiles (same complete current reference list for that hash). They
are durable before a prior source is moved. Dry-run makes no filesystem writes.
CLI output is only counters and generic error categories, never media names.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

HEX = re.compile(r'^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$')
SHA = re.compile(r'^[0-9a-f]{64}$')
MAX_BYTES = 16 * 1024 * 1024

class Unsafe(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def valid_hash(value):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise Unsafe('invalid hash')
    return value.upper()


def components(value):
    if not isinstance(value, str) or not value or '\\' in value or any(ord(c) < 32 for c in value):
        raise Unsafe('invalid path')
    parts = value.split('/')
    if any(p in ('', '.', '..') for p in parts) or value.startswith('/'):
        raise Unsafe('invalid path')
    return parts


def checked_root(value):
    raw = os.fspath(value)
    if not os.path.isabs(raw) or os.path.normpath(raw) != raw:
        raise Unsafe('root path must be canonical absolute')
    current = Path('/')
    for part in Path(raw).parts[1:]:
        current /= part
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise Unsafe('root alias or non-directory')
    return Path(raw)


def checked_path(root, relative, allow_missing=False):
    path = root
    for i, part in enumerate(components(relative)):
        path = path / part
        try:
            st = path.lstat()
        except FileNotFoundError:
            if allow_missing:
                # Check every existing prefix, never resolve untrusted paths.
                continue
            raise Unsafe('missing evidence')
        if i < len(components(relative)) - 1 and not stat.S_ISDIR(st.st_mode):
            raise Unsafe('path alias')
        if stat.S_ISLNK(st.st_mode):
            raise Unsafe('path alias')
    return path


def read_regular(path, limit=MAX_BYTES):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
            raise Unsafe('invalid evidence type')
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, min(65536, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise Unsafe('evidence too large')
            chunks.append(chunk)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or total != before.st_size:
            raise Unsafe('changed evidence')
        return b''.join(chunks)
    finally:
        os.close(fd)


def infohashes(data):
    """Hash the original bencoded info span, never its re-encoded representation."""
    if not data or len(data) > MAX_BYTES:
        raise Unsafe('invalid metainfo')
    pos = 0
    count = 0
    def parse(depth=0):
        nonlocal pos, count
        count += 1
        if depth > 32 or count > 100000 or pos >= len(data):
            raise Unsafe('invalid metainfo')
        start = pos
        token = data[pos:pos + 1]
        pos += 1
        if token == b'i':
            end = data.find(b'e', pos)
            if end < 0 or end - pos > 20 or not re.fullmatch(rb'(0|-?[1-9][0-9]*)', data[pos:end]) or data[pos:end] == b'-0':
                raise Unsafe('invalid metainfo')
            value = int(data[pos:end]); pos = end + 1
        elif token.isdigit():
            pos = start
            end = data.find(b':', pos, min(len(data), pos + 12))
            if end < 0 or not re.fullmatch(rb'(0|[1-9][0-9]*)', data[pos:end]):
                raise Unsafe('invalid metainfo')
            length = int(data[pos:end]); pos = end + 1
            if length > len(data) - pos:
                raise Unsafe('invalid metainfo')
            value = data[pos:pos + length]; pos += length
        elif token in (b'l', b'd'):
            value = [] if token == b'l' else {}
            previous = None
            while pos < len(data) and data[pos:pos + 1] != b'e':
                if token == b'l':
                    value.append(parse(depth + 1)[0])
                else:
                    key = parse(depth + 1)[0]
                    if not isinstance(key, bytes) or (previous is not None and key <= previous):
                        raise Unsafe('invalid metainfo')
                    previous = key
                    value[key] = parse(depth + 1)[0]
            if pos >= len(data):
                raise Unsafe('invalid metainfo')
            pos += 1
        else:
            raise Unsafe('invalid metainfo')
        return value, start, pos
    top, _, _ = parse()
    if pos != len(data) or not isinstance(top, dict) or b'info' not in top:
        raise Unsafe('invalid metainfo')
    # Locate the info span independently within the canonical top dictionary.
    pos = 1
    while pos < len(data) - 1:
        key = parse()[0]
        value, start, end = parse()
        if key == b'info':
            if not isinstance(value, dict) or not isinstance(value.get(b'name'), bytes) or not value[b'name']:
                raise Unsafe('invalid metainfo')
            if not isinstance(value.get(b'piece length'), int) or value[b'piece length'] <= 0:
                raise Unsafe('invalid metainfo')
            raw = data[start:end]
            result = set()
            version = value.get(b'meta version')
            if version not in (None, 2):
                raise Unsafe('invalid metainfo')
            if version == 2:
                if not isinstance(value.get(b'file tree'), dict) or not value[b'file tree']:
                    raise Unsafe('invalid metainfo')
                result.add(hashlib.sha256(raw).hexdigest().upper())
            if version is None or b'pieces' in value:
                pieces = value.get(b'pieces')
                if not isinstance(pieces, bytes) or not pieces or len(pieces) % 20 or not (
                    isinstance(value.get(b'length'), int) and value[b'length'] >= 0 or
                    isinstance(value.get(b'files'), list) and value[b'files']):
                    raise Unsafe('invalid metainfo')
                result.add(hashlib.sha1(raw).hexdigest().upper())
            return result
    raise Unsafe('invalid metainfo')


def atomic_write(path, data):
    fd, name = tempfile.mkstemp(prefix='.current-sources-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
        fsync_dir(path.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def media_matches(item):
    path = item.get('mediaPath')
    expected = item.get('mediaIdentity')
    if not isinstance(path, str) or not os.path.isabs(path) or os.path.normpath(path) != path or not isinstance(expected, dict):
        return False
    if any(type(expected.get(k)) is not int or expected[k] < 0 for k in ('dev', 'ino', 'size', 'mtimeNs')):
        return False
    try:
        checked_root(Path(path).parent)
        st = Path(path).lstat()
    except (Unsafe, OSError):
        return False
    return stat.S_ISREG(st.st_mode) and st.st_nlink >= 1 and (
        st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns) == tuple(
        expected[k] for k in ('dev', 'ino', 'size', 'mtimeNs'))


def normalized(snapshot):
    if snapshot.get('schemaVersion') != 1 or snapshot.get('service') not in ('sonarr', 'radarr'):
        raise Unsafe('invalid snapshot')
    for key in ('instance', 'arrItemId'):
        val = snapshot.get(key)
        if not isinstance(val, str) or not val or len(val) > 128 or any(ord(c) < 32 for c in val):
            raise Unsafe('invalid scope')
    if type(snapshot.get('sequence')) is not int or snapshot['sequence'] < 1:
        raise Unsafe('invalid sequence')
    files = snapshot.get('currentFiles')
    sources = snapshot.get('archiveSources')
    if not isinstance(files, list) or not isinstance(sources, list) or len(files) > 100000 or len(sources) > 100000:
        raise Unsafe('invalid inventory')
    return files, sources


def reconcile(snapshot, archive, retired, apply=False):
    """Return secret-free counters; blocked evidence never retires a source."""
    archive = checked_root(archive); retired = checked_root(retired)
    nested = retired == archive / '.retired'
    if (archive == retired or archive in retired.parents or retired in archive.parents) and not nested:
        raise Unsafe('overlapping roots')
    if archive.stat().st_dev != retired.stat().st_dev:
        raise Unsafe('atomic retirement requires same filesystem')
    files, sources = normalized(snapshot)
    result = {'blocked': 0, 'current': 0, 'retired': 0, 'planned': 0, 'replay': 0}
    # Dry-run must not create a lock file or state directory.
    lock = None
    high_water = 0
    receipt_path = None
    snapshot_digest = None
    try:
        if apply:
            lock = os.open(retired / '.torrent-current-sources.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
        scope = [snapshot[k] for k in ('service', 'instance', 'arrItemId')]
        receipt = '.current-sources-' + digest(json.dumps(scope, separators=(',', ':')).encode()) + '.json'
        receipt_path = retired / receipt
        snapshot_digest = digest(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode())
        if receipt_path.exists():
            prior = json.loads(read_regular(receipt_path, 4096))
            high_water = prior['sequence']
            if snapshot['sequence'] < high_water or (snapshot['sequence'] == high_water and snapshot_digest != prior['digest']):
                result['blocked'] = 1
                return result
            if snapshot['sequence'] == prior['sequence']:
                result['replay'] = 1
                return result
        if (snapshot.get('available') is not True or snapshot.get('complete') is not True or
                snapshot.get('inventoryComplete') is not True or snapshot.get('importsComplete') is not True or
                snapshot.get('inventoryStable') is not True or not files or not sources):
            result['blocked'] = 1
            return result
        refs = {}
        seen = set()
        for item in files:
            if not isinstance(item, dict) or not media_matches(item):
                result['blocked'] = 1; return result
            fileid = item.get('arrFileId'); path = item.get('importedPath')
            if not isinstance(fileid, str) or not fileid or not isinstance(path, str) or not path.startswith('/') or '\x00' in path or (fileid, path) in seen:
                result['blocked'] = 1; return result
            seen.add((fileid, path))
            try:
                h = valid_hash(item.get('downloadHash'))
            except Unsafe:
                result['blocked'] = 1; return result
            refs.setdefault(h, []).append({'arrFileId': fileid, 'importedPath': path})
        verified = []
        found = set()
        paths = set()
        for source in sources:
            if not isinstance(source, dict):
                raise Unsafe('invalid source')
            # Never reinterpret quarantined bytes as live archive inventory.
            if nested and isinstance(source.get('path'), str) and source['path'].startswith('.retired/'):
                components(source['path'])
                continue
            if source.get('instance') != snapshot['instance']:
                result['blocked'] = 1; return result
            h = valid_hash(source.get('hash'))
            rel = source.get('path'); side_rel = source.get('sidecarPath')
            if not isinstance(rel, str) or not rel.endswith('.torrent') or not isinstance(side_rel, str) or side_rel != rel[:-8] + '.provenance.json':
                raise Unsafe('invalid source paths')
            if rel in paths or side_rel in paths:
                raise Unsafe('duplicate source paths')
            paths.update((rel, side_rel))
            for key in ('sha256', 'sidecarSha256'):
                if not isinstance(source.get(key), str) or not SHA.fullmatch(source[key]):
                    raise Unsafe('invalid digest')
            src = checked_path(archive, rel, allow_missing=True)
            side = checked_path(archive, side_rel, allow_missing=True)
            dst = checked_path(retired, rel, allow_missing=True)
            dst_side = checked_path(retired, side_rel, allow_missing=True)
            if not src.exists() and not dst.exists():
                result['blocked'] = 1; return result
            if dst.exists():
                if digest(read_regular(dst)) != source['sha256'] or h not in infohashes(read_regular(dst)):
                    raise Unsafe('retirement collision')
                if src.exists():
                    raise Unsafe('retirement collision')
                if not dst_side.exists() or digest(read_regular(dst_side)) != source['sidecarSha256']:
                    raise Unsafe('retirement incomplete')
                retired_doc = json.loads(read_regular(dst_side))
                if (not isinstance(retired_doc, dict) or retired_doc.get('service') != snapshot['service'] or
                        str(retired_doc.get('arrItemId')) != snapshot['arrItemId'] or
                        valid_hash(retired_doc.get('downloadId')) != h or
                        retired_doc.get('torrentFile') != dst.name or
                        retired_doc.get('instance', retired_doc.get('service')) != snapshot['instance']):
                    raise Unsafe('retirement provenance')
                # A hardlink publication may have crashed before unlinking source.
                # A prior successful move without a committed receipt can be resumed.
                found.add(h)
                verified.append((source, src, side, dst, dst_side, None))
                continue
            raw = read_regular(src)
            if digest(raw) != source['sha256'] or h not in infohashes(raw):
                result['blocked'] = 1; return result
            if not apply and not side.exists() and isinstance(source.get('proposedSidecar'), dict):
                # Preview only: the collector's proposal is not persisted evidence.
                side_data = (json.dumps(source['proposedSidecar'], sort_keys=True,
                                        separators=(',', ':')) + '\n').encode()
                if len(side_data) > MAX_BYTES:
                    result['blocked'] = 1; return result
            else:
                side_data = read_regular(side)
            if digest(side_data) != source['sidecarSha256']:
                result['blocked'] = 1; return result
            try:
                doc = json.loads(side_data)
            except (ValueError, UnicodeError):
                result['blocked'] = 1; return result
            if not isinstance(doc, dict):
                result['blocked'] = 1; return result
            side_instance = doc.get('instance', doc.get('service'))
            if not isinstance(doc, dict) or doc.get('service') != snapshot['service'] or str(doc.get('arrItemId')) != snapshot['arrItemId'] or valid_hash(doc.get('downloadId')) != h or doc.get('torrentFile') != src.name or side_instance != snapshot['instance']:
                result['blocked'] = 1; return result
            if dst.exists():
                raise Unsafe('retirement collision')
            if dst_side.exists() and digest(read_regular(dst_side)) != source['sidecarSha256']:
                raise Unsafe('retirement collision')
            found.add(h)
            verified.append((source, src, side, dst, dst_side, doc))
        if not set(refs).issubset(found):
            result['blocked'] = 1; return result
        by_hash = {}
        for v in verified:
            if v[5] is not None and v[0]['hash'].upper() in refs:
                by_hash.setdefault(v[0]['hash'].upper(), []).append(v)
        # Collision suffixes are fallback names, not additional current sources.
        preferred = {min(group, key=lambda v: (
            bool(re.search(r'-[0-9a-fA-F]{8,64}\.torrent$', v[1].name)), v[0]['path']))[0]['path']
                     for group in by_hash.values()}
        retiring = [v for v in verified if v[5] is not None and v[0]['path'] not in preferred]
        current = [v for v in verified if v[5] is not None and v[0]['path'] in preferred]
        if retiring and not current:
            # No new current source with proven sidecar: do not prune.
            result['blocked'] = 1; return result
        result['planned'] = len(retiring)
        result['current'] = len(current)
        if not apply:
            return result
        # Revalidate all evidence immediately before mutation under controller lock.
        for source, src, side, dst, dst_side, doc in verified:
            if doc is not None and (digest(read_regular(src)) != source['sha256'] or digest(read_regular(side)) != source['sidecarSha256']):
                raise Unsafe('changed evidence')
        for source, src, side, dst, dst_side, doc in current:
            doc['schemaVersion'] = 2
            doc['instance'] = snapshot['instance']
            doc['provenanceCoverage'] = 'complete-current-snapshot'
            doc['currentReferences'] = sorted(refs[source['hash'].upper()], key=lambda x: (x['arrFileId'], x['importedPath']))
            doc['importedFiles'] = doc['currentReferences']
            atomic_write(side, (json.dumps(doc, sort_keys=True, separators=(',', ':')) + '\n').encode())
        # Sidecar is copied to quarantine first, then the torrent is atomically
        # moved, then old sidecar moved away. Collision is checked beforehand.
        for source, src, side, dst, dst_side, doc in retiring:
            if not all(media_matches(item) for item in files):
                raise Unsafe('changed media')
            dst.parent.mkdir(parents=True, exist_ok=True)
            checked_path(retired, source['path']) if dst.exists() else checked_path(retired, source['path'], True)
            if dst.exists():
                raise Unsafe('retirement collision')
            data = read_regular(side)
            if dst_side.exists():
                if digest(read_regular(dst_side)) != source['sidecarSha256']:
                    raise Unsafe('retirement collision')
            else:
                fd = os.open(dst_side, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as f:
                    f.write(data); f.flush(); os.fsync(f.fileno())
                fsync_dir(dst_side.parent)
            if digest(read_regular(src)) != source['sha256'] or digest(read_regular(side)) != source['sidecarSha256']:
                raise Unsafe('changed evidence')
            # link is exclusive (rename would overwrite a late foreign destination).
            os.link(src, dst, follow_symlinks=False)
            fsync_dir(dst.parent)
            src.unlink()
            fsync_dir(src.parent); fsync_dir(dst.parent)
            # Keep the original sidecar as a second copy until receipt is durable.
            result['retired'] += 1
        atomic_write(receipt_path, (json.dumps({'sequence': snapshot['sequence'], 'digest': snapshot_digest}) + '\n').encode())
        # Remove ONLY duplicate sidecars after receipt, never torrent bytes.
        for source, src, side, dst, dst_side, doc in retiring:
            if side.exists() and digest(read_regular(side)) == source['sidecarSha256']:
                side.unlink()
                fsync_dir(side.parent)
        return result
    finally:
        try:
            # Even an unavailable/incomplete newer observation fences older events.
            if (apply and result['blocked'] and receipt_path is not None and snapshot_digest is not None
                    and snapshot['sequence'] > high_water):
                atomic_write(receipt_path, (json.dumps({'sequence': snapshot['sequence'],
                                                        'digest': snapshot_digest, 'blocked': True}) + '\n').encode())
        finally:
            if lock is not None:
                fcntl.flock(lock, fcntl.LOCK_UN)
                os.close(lock)


def main():
    parser = argparse.ArgumentParser(description='Conservative torrent source reconciliation')
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--archive-root', required=True)
    parser.add_argument('--retired-root', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        data = read_regular(Path(args.snapshot), 32 * 1024 * 1024)
        result = reconcile(json.loads(data), args.archive_root, args.retired_root, args.apply)
    except (Unsafe, OSError, ValueError, KeyError, TypeError) as exc:
        # Never surface file paths, media names or JSON content.
        print(json.dumps({'error': type(exc).__name__, 'blocked': 1}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
