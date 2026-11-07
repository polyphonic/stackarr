#!/usr/bin/env python3
"""Synthetic native API integration tests; no runtime credentials or media."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from typing import Any
from urllib.parse import parse_qs, urlsplit

SCRIPT = Path(__file__).resolve().parents[3] / 'stackarr/scripts/torrent-current-inventory.py'


def enc(x):
    if isinstance(x, int):
        return b'i' + str(x).encode() + b'e'
    if isinstance(x, str):
        x = x.encode()
    if isinstance(x, bytes):
        return str(len(x)).encode() + b':' + x
    return b'd' + b''.join(enc(k) + enc(v) for k, v in sorted(x.items())) + b'e'


class Handler(BaseHTTPRequestHandler):
    server: Any

    def do_GET(self):
        if self.headers.get('X-Api-Key') != 'A' * 32:
            self.send_error(403); return
        url = urlsplit(self.path)
        key = url.path.split('/')[-1]
        if key == 'history' or key == 'queue':
            rows = self.server.fixture.history if key == 'history' else self.server.fixture.queue
            query = parse_qs(url.query)
            if key == 'queue' and 'sortKey' in query:
                self.send_error(400); return
            page = int(query['page'][0]); size = int(query['pageSize'][0])
            obj = {'totalRecords': len(rows), 'records': rows[(page - 1) * size:page * size]}
            if self.server.fixture.bad_pages and page > 1:
                obj['totalRecords'] += 1
        else:
            obj = self.server.fixture.api[key]
            if key == 'movie':
                self.server.fixture.catalog_reads += 1
                obj = json.loads(json.dumps(obj))
                if self.server.fixture.change_statistics:
                    obj[0]['statistics'] = {'changingDisplayCount': self.server.fixture.catalog_reads}
                if self.server.fixture.change_catalog_path and self.server.fixture.catalog_reads > 1:
                    obj[0]['path'] = '/movies/Other'
            if key == 'moviefile' and self.server.fixture.change_files:
                self.server.fixture.file_reads += 1
                if self.server.fixture.file_reads > 1:
                    obj = []
        data = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.archive = self.base / 'archive'
        self.media = self.base / 'media'
        self.config = self.base / 'config'
        for p in (self.archive / '.retired', self.media / 'Movies', self.config / 'radarr', self.config / 'sonarr'):
            p.mkdir(parents=True)
        for instance in ('radarr', 'sonarr'):
            (self.config / instance / 'config.xml').write_text('<Config><ApiKey>' + 'A' * 32 + '</ApiKey></Config>')
        self.api = {'movie': [{'id': 7, 'path': '/movies/Film', 'movieFileId': 20}],
                    'moviefile': [{'id': 20, 'movieId': 7, 'path': '/movies/Film/current.mkv'}]}
        media_file = self.media / 'Movies/Film/current.mkv'
        media_file.parent.mkdir()
        media_file.write_bytes(b'media')
        self.history = []
        self.queue = []
        self.bad_pages = False
        self.change_files = False
        self.file_reads = 0
        self.catalog_reads = 0
        self.change_statistics = False
        self.change_catalog_path = False
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.fixture = self
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def source(self, name, sidecar=True, hash_override=None):
        info = enc({'name': name, 'piece length': 16384, 'pieces': b'x' * 20, 'length': 5})
        raw = enc({'info': {'name': name, 'piece length': 16384, 'pieces': b'x' * 20, 'length': 5}})
        h = hashlib.sha1(info).hexdigest().upper()
        folder = self.archive / 'Movies/Film'
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (name + '.torrent')
        path.write_bytes(raw)
        side = path.with_suffix('.provenance.json')
        if sidecar:
            side.write_text(json.dumps({'schemaVersion': 1, 'service': 'radarr', 'instance': 'radarr',
                'arrItemId': '7', 'downloadId': hash_override or h, 'torrentFile': path.name}))
        return h, path, side

    def imported(self, file_id, h, path='/movies/Film/current.mkv', row_id=None):
        self.history.append({'id': row_id or len(self.history) + 1, 'eventType': 'downloadFolderImported',
                             'movieId': 7, 'downloadId': h, 'data': {'fileId': file_id, 'importedPath': path}})

    def run_cli(self, *extra):
        return subprocess.run([sys.executable, str(SCRIPT), '--archive-root', str(self.archive),
            '--media-root', str(self.media), '--config-root', str(self.config), '--instance', 'radarr',
            '--url', self.url, '--item-id', '7', *extra], capture_output=True, text=True, timeout=20)

    def test_upgraded_id_retained_only_as_historical(self):
        _, old, _ = self.source('old')
        h, current, _ = self.source('new')
        self.imported(19, hashlib.sha1(enc({'name': 'old', 'piece length': 16384, 'pieces': b'x' * 20, 'length': 5})).hexdigest().upper())
        self.imported(20, h)
        dry = self.run_cli()
        self.assertEqual(json.loads(dry.stdout)['planned'], 1, dry.stdout)
        self.assertTrue(old.exists())
        result = self.run_cli('--apply')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse(old.exists()); self.assertTrue(current.exists())

    def test_wrong_path_and_unknown_history_block(self):
        h, old, _ = self.source('old')
        self.source('new')
        self.imported(20, h, '/movies/Film/other.mkv')
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(old.exists())
        self.history.clear()
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(old.exists())

    def test_native_catalog_trailing_directory_separator(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        self.api['movie'][0]['path'] = '/movies/Film/'
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(path.exists())
        self.api['movie'][0]['path'] = '/movies/Film//'
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_queue_uses_native_sort_and_holds_pending_scope(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        self.queue = [{'id': 1, 'movieId': 99}]
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.queue[0]['movieId'] = 7
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(path.exists())

    def test_incomplete_pagination_blocks(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        self.history.extend({'id': i, 'eventType': 'grabbed'} for i in range(2, 253))
        self.bad_pages = True
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(path.exists())
        self.bad_pages = False
        self.assertEqual(self.run_cli().returncode, 0)

    def test_display_statistics_do_not_block_stable_file_identity(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        self.change_statistics = True
        result = self.run_cli('--apply')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(path.exists())

    def test_changed_catalog_path_still_blocks(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        self.change_catalog_path = True
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(path.exists())

    def test_changing_api_inventory_blocks(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        self.change_files = True
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(path.exists())

    def test_extra_moviefile_without_history_blocks_entire_scope(self):
        h, path, _ = self.source('only')
        self.imported(20, h)
        extra = self.media / 'Movies/Film/extra.mkv'
        extra.write_bytes(b'extra edition')
        self.api['moviefile'].append({'id': 21, 'movieId': 7, 'path': '/movies/Film/extra.mkv'})
        self.assertNotEqual(self.run_cli('--apply').returncode, 0)
        self.assertTrue(path.exists())

    def test_sonarr_upgrade_joins_all_episode_ids_not_prior_file_id(self):
        self.api = {'series': [{'id': 7, 'path': '/tv/Show/'}],
                    'episode': [{'id': 80, 'seriesId': 7, 'episodeFileId': 20},
                                {'id': 81, 'seriesId': 7, 'episodeFileId': 20}],
                    'episodefile': [{'id': 20, 'seriesId': 7, 'path': '/tv/Show/current.mkv'}]}
        tv = self.media / 'TV Shows/Show/current.mkv'
        tv.parent.mkdir(parents=True)
        tv.write_bytes(b'media')
        folder = self.archive / 'TV Shows/Show'
        folder.mkdir(parents=True)
        hashes = []
        for label in ('old', 'new'):
            info = enc({'name': label, 'piece length': 16384, 'pieces': b'x' * 20, 'length': 5})
            h = hashlib.sha1(info).hexdigest().upper()
            path = folder / (label + '.torrent')
            path.write_bytes(enc({'info': {'name': label, 'piece length': 16384, 'pieces': b'x' * 20, 'length': 5}}))
            path.with_suffix('.provenance.json').write_text(json.dumps({'service': 'sonarr', 'arrItemId': '7',
                'downloadId': h, 'torrentFile': path.name}))
            hashes.append(h)
        self.history = [{'id': i + 1, 'eventType': 'downloadFolderImported', 'seriesId': 7,
                         'episodeId': 80 + i, 'downloadId': h,
                         'data': {'fileId': 19 + i, 'importedPath': '/tv/Show/current.mkv'}}
                        for i, h in enumerate(hashes)]
        cmd = [sys.executable, str(SCRIPT), '--archive-root', str(self.archive), '--media-root', str(self.media),
               '--config-root', str(self.config), '--instance', 'sonarr', '--url', self.url, '--item-id', '7']
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)['planned'], 1)

        # A multi-show source cannot be retired using only this show's files.
        self.history.append({'id': 3, 'eventType': 'downloadFolderImported',
                             'seriesId': 8, 'episodeId': 90, 'downloadId': hashes[0],
                             'data': {'fileId': 91, 'importedPath': '/tv/Other/current.mkv'}})
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertTrue((folder/'old.torrent').exists())

    def test_enrich_requires_exact_history_and_apply(self):
        h, path, side = self.source('only', sidecar=False)
        self.imported(20, h)
        self.assertEqual(self.run_cli('--enrich').returncode, 0)
        self.assertFalse(side.exists())
        result = self.run_cli('--enrich', '--apply')
        self.assertEqual(result.returncode, 0, result.stdout)
        doc = json.loads(side.read_text())
        self.assertEqual(doc['retrospectiveEvidence'], 'exact-native-import-history')
        self.assertEqual(doc['downloadId'], h)
        self.assertTrue(path.exists())

    def test_pending_retained_on_failure_and_cleared_on_success(self):
        pending = self.archive / '_Pending/radarr'
        pending.mkdir(parents=True)
        request = pending / '7.json'
        request.write_text(json.dumps({'schemaVersion': 1, 'instance': 'radarr', 'arrItemId': '7'}))
        cmd = [sys.executable, str(SCRIPT), '--archive-root', str(self.archive), '--media-root', str(self.media),
               '--config-root', str(self.config), '--instance', 'radarr', '--url', self.url, '--apply']
        self.assertNotEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
        self.assertTrue(request.exists())
        h, _, _ = self.source('only')
        self.imported(20, h)
        self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
        self.assertFalse(request.exists())

if __name__ == '__main__':
    unittest.main()
