#!/usr/bin/env python3
"""Collect conservative native Arr inventory and invoke torrent-current-sources.py.

One invocation covers one instance. Dry-run is read-only. Apply serializes collector
sequences, rechecks API and pending requests, and invokes the engine only when
all provenance and physical media checks pass. Output contains counters only.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

SPEC = importlib.util.spec_from_file_location('torrent_current_sources', Path(__file__).with_name('torrent-current-sources.py'))
assert SPEC is not None and SPEC.loader is not None
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)
MAX_BODY = 32 * 1024 * 1024
MAX_PAGES = 10000
PAGE_SIZE = 250
INSTANCES = ('sonarr', 'radarr', 'sonarr4k', 'radarr4k')
EXCLUDED = {'.retired', '_Captured', '_Unresolved', '_Pending', '.metadata'}

class Blocked(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Blocked('redirect')


def load_key(root):
    path = engine.checked_path(engine.checked_root(root), 'config.xml')
    data = engine.read_regular(path, 1024 * 1024)
    try:
        key = ET.fromstring(data).findtext('ApiKey')
    except ET.ParseError:
        raise Blocked('config') from None
    if not key or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', key):
        raise Blocked('config')
    return key


class Native:
    def __init__(self, url, key):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise Blocked('url')
        self.url = url.rstrip('/') + '/api/v3/'
        self.opener = urllib.request.build_opener(NoRedirect())
        self.key = key

    def get(self, endpoint, **query):
        url = urllib.parse.urljoin(self.url, endpoint) + ('?' + urllib.parse.urlencode(query) if query else '')
        req = urllib.request.Request(url, headers={'X-Api-Key': self.key, 'Accept': 'application/json'})
        with self.opener.open(req, timeout=12) as response:
            if response.status != 200 or response.headers.get('Content-Length') and int(response.headers['Content-Length']) > MAX_BODY:
                raise Blocked('api')
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise Blocked('api')
            return json.loads(raw)

    def pages(self, endpoint):
        rows = []
        total = None
        ids = set()
        for page in range(1, MAX_PAGES + 1):
            query: dict[str, object] = {'page': page, 'pageSize': PAGE_SIZE}
            if endpoint == 'history':
                query.update(sortKey='date', sortDirection='descending')
            # Queue has its own supported sort keys; use the native default.
            result = self.get(endpoint, **query)
            if not isinstance(result, dict) or type(result.get('totalRecords')) is not int or not isinstance(result.get('records'), list):
                raise Blocked('pagination')
            if total is None:
                total = result['totalRecords']
            if total != result['totalRecords'] or total < 0 or len(result['records']) > PAGE_SIZE:
                raise Blocked('pagination')
            for row in result['records']:
                if not isinstance(row, dict) or type(row.get('id')) is not int or row['id'] in ids:
                    raise Blocked('pagination')
                ids.add(row['id'])
                rows.append(row)
            if len(rows) == total:
                return rows
            if not result['records'] or len(rows) > total:
                raise Blocked('pagination')
        raise Blocked('pagination')


def integer_id(value):
    if type(value) is not int or value <= 0:
        raise Blocked('id')
    return value


def regular_media(media_root, service, api_path):
    prefix = '/tv/' if service == 'sonarr' else '/movies/'
    if not isinstance(api_path, str) or not api_path.startswith(prefix):
        raise Blocked('media-root')
    suffix = api_path[len(prefix):]
    engine.components(suffix)
    root = engine.checked_root(media_root)
    library = 'TV Shows' if service == 'sonarr' else 'Movies'
    path = engine.checked_path(root, library + '/' + suffix)
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or not st.st_nlink:
        raise Blocked('media-type')
    return str(path), {'dev': st.st_dev, 'ino': st.st_ino, 'size': st.st_size, 'mtimeNs': st.st_mtime_ns}


def scope_folder(item, service):
    path = item.get('path')
    prefix = '/tv/' if service == 'sonarr' else '/movies/'
    if not isinstance(path, str) or not path.startswith(prefix):
        raise Blocked('catalog-path')
    # Native Arr catalogs may include one trailing directory separator.
    # Preserve strict rejection of traversal, empty interior parts and aliases.
    parts = engine.components(path[len(prefix):].removesuffix('/'))
    # Catalog path names the item directory; only that exact archive folder is in scope.
    return ('TV Shows' if service == 'sonarr' else 'Movies') + '/' + '/'.join(parts)


def primary_torrents(archive, folder):
    base = engine.checked_path(archive, folder)
    result = []
    def walk(directory):
        for entry in os.scandir(directory):
            if entry.name in EXCLUDED or entry.name.startswith('.current-sources-'):
                continue
            st = entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(st.st_mode):
                walk(Path(entry.path))
            elif entry.name.endswith('.torrent'):
                if not stat.S_ISREG(st.st_mode):
                    raise Blocked('archive-type')
                result.append(Path(entry.path))
            elif stat.S_ISLNK(st.st_mode):
                raise Blocked('archive-alias')
    walk(base)
    return sorted(result)


def publish_new_sidecar(path, data):
    """Publish complete bytes without replacing an existing sidecar."""
    fd, temporary = tempfile.mkstemp(prefix='.provenance-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path, follow_symlinks=False)
    finally:
        os.unlink(temporary)
    engine.fsync_dir(path.parent)


def sources(archive, folder, instance, service, item_id, imports, enrich=False, apply=False):
    found = []
    for path in primary_torrents(archive, folder):
        rel = str(path.relative_to(archive))
        raw = engine.read_regular(path)
        hashes = engine.infohashes(raw)
        side = path.with_suffix('.provenance.json')
        proposed = None
        if not side.exists():
            owners = {h for h in hashes if h in imports}
            # Only a single hash with exact native import ownership can create evidence.
            if not enrich or len(owners) != 1 or len(hashes) != 1:
                raise Blocked('missing-provenance')
            h = next(iter(owners))
            records = imports[h]
            if not records or any(r['item'] != item_id for r in records):
                raise Blocked('ambiguous-provenance')
            doc = {'schemaVersion': 1, 'archiveScope': 'torrent-source', 'provenanceCoverage': 'retrospective-native-import',
                   'service': service, 'instance': instance, 'arrItemId': str(item_id), 'downloadId': h,
                   'torrentFile': path.name, 'retrospectiveEvidence': 'exact-native-import-history',
                   'importedFiles': sorted([{'arrFileId': r['file'], 'importedPath': r['path']} for r in records], key=lambda x: (x['arrFileId'], x['importedPath']))}
            side_bytes = (json.dumps(doc, sort_keys=True, separators=(',', ':')) + '\n').encode()
            if apply:
                # No replacement, even if another writer published in the meantime.
                publish_new_sidecar(side, side_bytes)
            else:
                proposed = doc
        else:
            side_bytes = engine.read_regular(engine.checked_path(archive, str(side.relative_to(archive))))
        doc = json.loads(side_bytes)
        if not isinstance(doc, dict) or doc.get('service') != service or doc.get('instance', doc.get('service')) != instance or str(doc.get('arrItemId')) != str(item_id) or doc.get('torrentFile') != path.name:
            raise Blocked('provenance')
        h = engine.valid_hash(doc.get('downloadId'))
        if h not in hashes:
            raise Blocked('provenance-hash')
        found.append({'path': rel, 'instance': instance, 'hash': h, 'sha256': engine.digest(raw),
                      'sidecarPath': str(side.relative_to(archive)), 'sidecarSha256': engine.digest(side_bytes)})
        if proposed is not None:
            found[-1]['proposedSidecar'] = proposed
    return found


def history_imports(rows, service, episodes):
    by_hash = {}
    by_file = {}
    for row in rows:
        if row.get('eventType') not in ('downloadFolderImported', 3):
            continue
        data = row.get('data')
        item = row.get('seriesId' if service == 'sonarr' else 'movieId')
        raw_hash = row.get('downloadId')
        file_id = data.get('fileId') if isinstance(data, dict) else None
        path = data.get('importedPath') if isinstance(data, dict) else None
        if type(item) is not int or item <= 0 or file_id is None:
            continue
        if service == 'sonarr' and item in episodes and row.get('episodeId') not in episodes[item]:
            # Some imports include episode IDs only for one of a pack's episodes;
            # nonmatching rows cannot establish this scope's ownership. Preserve
            # foreign-series records below so shared hashes block retirement.
            continue
        try:
            h = engine.valid_hash(raw_hash)
        except engine.Unsafe:
            h = None
        record = {'item': item, 'file': str(file_id), 'path': path, 'hash': h}
        if h and isinstance(path, str):
            by_hash.setdefault(h, []).append(record)
        by_file.setdefault((item, str(file_id)), []).append(record)
    return by_hash, by_file


def inventory(native, archive, media_root, instance, item, history, queue, enrich=False, apply=False):
    service = 'sonarr' if instance.startswith('sonarr') else 'radarr'
    item_id = integer_id(item['id'])
    folder = scope_folder(item, service)
    if service == 'sonarr':
        episodes = native.get('episode', seriesId=item_id)
        records = native.get('episodefile', seriesId=item_id)
        if not isinstance(episodes, list) or not isinstance(records, list):
            raise Blocked('inventory')
        episode_ids = {integer_id(e['id']) for e in episodes}
        mapped = {integer_id(e['episodeFileId']) for e in episodes if e.get('episodeFileId')}
        mapping = {item_id: episode_ids}
    else:
        records = native.get('moviefile', movieId=item_id)
        if not isinstance(records, list):
            raise Blocked('inventory')
        mapped = set()
        pointer = item.get('movieFileId')
        if pointer:
            mapped.add(integer_id(pointer))
        mapping = {}
    by_hash, by_file = history_imports(history, service, mapping)
    files = []
    seen = set()
    for record in records:
        fid = integer_id(record['id'])
        if fid in seen or record.get('seriesId' if service == 'sonarr' else 'movieId') != item_id:
            raise Blocked('inventory')
        seen.add(fid)
        imported = record.get('path')
        media_path, identity = regular_media(media_root, service, imported)
        matches = {r['hash'] for r in by_file.get((item_id, str(fid)), []) if r['path'] == imported}
        # A different path for the same ID is conflicting ownership, not an upgrade.
        all_records = by_file.get((item_id, str(fid)), [])
        h = next(iter(matches)) if len(matches) == 1 and all(r['path'] == imported and r['hash'] in matches for r in all_records) else None
        files.append({'arrFileId': str(fid), 'importedPath': imported, 'mediaPath': media_path,
                      'mediaIdentity': identity, 'downloadHash': h})
    if not mapped.issubset(seen):
        raise Blocked('inventory-gap')
    archive_sources = sources(archive, folder, instance, service, item_id, by_hash, enrich, apply)
    # Every candidate for retirement needs an actual import binding for this
    # item. A sidecar or archive placement alone is never historical proof.
    source_proven = bool(archive_sources) and all(
        by_hash.get(s['hash']) and all(r['item'] == item_id for r in by_hash[s['hash']])
        for s in archive_sources)
    pending_queue = any(r.get('seriesId' if service == 'sonarr' else 'movieId') == item_id for r in queue)
    complete = bool(files and source_proven and all(f['downloadHash'] for f in files) and not pending_queue)
    return {'schemaVersion': 1, 'service': service, 'instance': instance, 'arrItemId': str(item_id),
            'available': True, 'complete': complete, 'inventoryComplete': True, 'importsComplete': complete,
            'inventoryStable': True, 'currentFiles': files, 'archiveSources': archive_sources}


def pending_requests(archive, instance):
    directory = archive / '_Pending' / instance
    if not directory.exists():
        return {}
    engine.checked_path(archive, '_Pending/' + instance)
    requests = {}
    for entry in os.scandir(directory):
        if not entry.name.endswith('.json'):
            continue
        if not re.fullmatch(r'[1-9][0-9]*\.json', entry.name):
            raise Blocked('pending')
        raw = engine.read_regular(engine.checked_path(archive, '_Pending/' + instance + '/' + entry.name), 16384)
        doc = json.loads(raw)
        ident = int(entry.name[:-5])
        if not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or doc.get('instance') != instance or str(doc.get('arrItemId')) != str(ident):
            raise Blocked('pending')
        requests[ident] = engine.digest(raw)
    return requests


def run(args):
    archive = engine.checked_root(args.archive_root)
    retired = Path(args.retired_root) if args.retired_root else archive / '.retired'
    retired = engine.checked_root(retired)
    media = engine.checked_root(args.media_root)
    native = Native(args.url, load_key(Path(args.config_root) / args.instance))
    service = 'sonarr' if args.instance.startswith('sonarr') else 'radarr'
    endpoint = 'series' if service == 'sonarr' else 'movie'
    lock = None
    try:
        if args.apply:
            lock = os.open(retired / '.torrent-current-inventory.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
        pending = pending_requests(archive, args.instance)
        catalog = native.get(endpoint)
        if not isinstance(catalog, list):
            raise Blocked('catalog')
        items = {integer_id(x['id']): x for x in catalog}
        if len(items) != len(catalog):
            raise Blocked('catalog')
        if args.all:
            ids = sorted(i for i, item in items.items() if (archive / scope_folder(item, service)).is_dir())
        elif args.item_id:
            ids = sorted(set(args.item_id))
        else:
            ids = sorted(pending)
        if any(i not in items for i in ids):
            raise Blocked('scope')
        if not ids:
            return {'scopes': 0, 'blocked': 0, 'planned': 0, 'retired': 0}
        history = native.pages('history')
        queue = native.pages('queue')
        counts = {'scopes': 0, 'blocked': 0, 'planned': 0, 'retired': 0}
        for ident in ids:
            counts['scopes'] += 1
            try:
                snapshot = inventory(native, archive, media, args.instance, items[ident], history, queue, args.enrich, False)
                # Incomplete evidence can only fence older snapshots. Do not
                # spend another full history scan or publish sidecars for it.
                if args.apply and snapshot['complete']:
                    # Re-fetch full instance history/queue and the scope's current API files,
                    # and compare every byte-bound snapshot field before any sidecar write.
                    fresh_catalog = native.get(endpoint)
                    fresh_items = {integer_id(x['id']): x for x in fresh_catalog}
                    if len(fresh_items) != len(fresh_catalog) or ident not in fresh_items or pending_requests(archive, args.instance) != pending:
                        raise Blocked('changed')
                    # Airing statistics and unrelated catalog entries are not
                    # file ownership. Bind this item to its exact library path
                    # and movie-file pointer; the complete file inventory below
                    # still has to match byte-for-byte, including media identity.
                    for field in ('id', 'path', 'movieFileId'):
                        if fresh_items[ident].get(field) != items[ident].get(field):
                            raise Blocked('changed')
                    fresh_history = native.pages('history')
                    fresh_queue = native.pages('queue')
                    if fresh_history != history or fresh_queue != queue:
                        raise Blocked('changed')
                    fresh = inventory(native, archive, media, args.instance, fresh_items[ident], fresh_history, fresh_queue, args.enrich, False)
                    if fresh != snapshot:
                        raise Blocked('changed')
                    # Missing sidecars are created only after the fresh readback.
                    if args.enrich:
                        fresh = inventory(native, archive, media, args.instance, fresh_items[ident], fresh_history, fresh_queue, True, True)
                        snapshot = fresh
                scope = [service, args.instance, str(ident)]
                name = '.inventory-' + engine.digest(json.dumps(scope, separators=(',', ':')).encode()) + '.json'
                state = retired / name
                prior = json.loads(engine.read_regular(state, 4096))['sequence'] if state.exists() else 0
                if type(prior) is not int or prior < 0:
                    raise Blocked('sequence')
                snapshot['sequence'] = prior + 1
                if args.apply:
                    engine.atomic_write(state, (json.dumps({'sequence': snapshot['sequence']}) + '\n').encode())
                result = engine.reconcile(snapshot, archive, retired, args.apply)
                counts['blocked'] += result['blocked']
                counts['planned'] += result['planned']
                counts['retired'] += result['retired']
                if args.apply and not result['blocked'] and ident in pending:
                    path = engine.checked_path(archive, '_Pending/' + args.instance + '/' + str(ident) + '.json')
                    if engine.digest(engine.read_regular(path, 16384)) == pending[ident]:
                        path.unlink()
                        engine.fsync_dir(path.parent)
                    pending = pending_requests(archive, args.instance)
            except (Blocked, engine.Unsafe, OSError, ValueError, KeyError, TypeError):
                counts['blocked'] += 1
        return counts
    finally:
        if lock is not None:
            fcntl.flock(lock, fcntl.LOCK_UN)
            os.close(lock)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Native Arr torrent current-source collector')
    for name in ('archive-root', 'media-root', 'config-root', 'url'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--retired-root')
    parser.add_argument('--instance', required=True, choices=INSTANCES)
    parser.add_argument('--item-id', type=int, action='append')
    parser.add_argument('--pending', action='store_true', help='scan pending requests (default without IDs)')
    parser.add_argument('--all', action='store_true', help='reconcile catalog items with archive folders')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--enrich', action='store_true', help='create missing sidecars from exact native imports on apply')
    args = parser.parse_args(argv)
    if args.all and args.item_id or args.pending and (args.all or args.item_id) or args.item_id and any(i <= 0 for i in args.item_id):
        parser.error('select one positive scope mode')
    try:
        result = run(args)
    except (Blocked, engine.Unsafe, OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        result = {'scopes': 0, 'blocked': 1, 'planned': 0, 'retired': 0}
    print(json.dumps(result, sort_keys=True))
    return 2 if result['blocked'] else 0

if __name__ == '__main__':
    sys.exit(main())
