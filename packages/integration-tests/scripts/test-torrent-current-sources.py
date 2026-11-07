#!/usr/bin/env python3
"""Reconciliation contract tests: python3 this-file.py (no live media)."""
import hashlib
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[3] / 'stackarr/scripts/torrent-current-sources.py'
H1 = 'A' * 40
H2 = 'B' * 40


def enc(x):
    if isinstance(x, int):
        return b'i' + str(x).encode() + b'e'
    if isinstance(x, str):
        x = x.encode()
    if isinstance(x, bytes):
        return str(len(x)).encode() + b':' + x
    if isinstance(x, list):
        return b'l' + b''.join(enc(y) for y in x) + b'e'
    return b'd' + b''.join(enc(k) + enc(v) for k, v in sorted(x.items())) + b'e'


def torrent(label):
    return enc({'info': {'name': label, 'piece length': 16384, 'pieces': b'x' * 20,
                         'length': 10}})


class ReconcileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.archive = self.base / 'archive'
        self.retired = self.base / 'retired'
        self.archive.mkdir()
        self.retired.mkdir()
        self.sources = []
        self.files = []

    def source(self, label):
        data = torrent(label)
        h = hashlib.sha1(data[data.index(b'4:info') + 6:-1]).hexdigest().upper()
        folder = self.archive / 'TV Shows/Show/Season 01'
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (label + '.torrent')
        path.write_bytes(data)
        side = path.with_suffix('.provenance.json')
        side.write_text(json.dumps({'schemaVersion': 1, 'service': 'sonarr', 'arrItemId': '7',
                                   'downloadId': h, 'torrentFile': path.name, 'arrFileId': '1',
                                   'importedPath': '/tv/Show/Season 01/1.mkv'}))
        self.sources.append({'path': str(path.relative_to(self.archive)), 'instance': 'sonarr', 'hash': h,
                             'sha256': hashlib.sha256(data).hexdigest(),
                             'sidecarPath': str(side.relative_to(self.archive)),
                             'sidecarSha256': hashlib.sha256(side.read_bytes()).hexdigest()})
        return h, path, side

    def file(self, n, h):
        media = self.base / 'media' / (str(n) + '.mkv')
        media.parent.mkdir(exist_ok=True)
        media.write_bytes(b'current library file')
        st = media.stat()
        self.files.append({'arrFileId': str(n), 'importedPath': '/tv/Show/Season 01/' + str(n) + '.mkv',
                           'mediaPath': str(media), 'mediaIdentity': {'dev': st.st_dev, 'ino': st.st_ino,
                           'size': st.st_size, 'mtimeNs': st.st_mtime_ns}, 'downloadHash': h})

    def snapshot(self, sequence=1, **kwargs):
        return {'schemaVersion': 1, 'service': 'sonarr', 'instance': 'sonarr', 'arrItemId': '7',
                'sequence': sequence, 'available': True, 'complete': True, 'inventoryComplete': True,
                'importsComplete': True, 'inventoryStable': True,
                'currentFiles': self.files, 'archiveSources': self.sources, **kwargs}

    def run_cli(self, snapshot, apply=False, retired=None):
        p = self.base / 'snapshot.json'
        p.write_text(json.dumps(snapshot))
        return subprocess.run([sys.executable, str(SCRIPT), '--snapshot', str(p),
                               '--archive-root', str(self.archive), '--retired-root', str(retired or self.retired)]
                              + (['--apply'] if apply else []), capture_output=True, text=True)

    def test_partial_pack_retains_old_and_updates_all_current_refs(self):
        old, old_path, _ = self.source('pack')
        new, _, new_side = self.source('upgrade')
        self.file(1, new)
        self.file(2, old)
        result = self.run_cli(self.snapshot(), True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(old_path.exists())
        self.assertEqual(len(json.loads(new_side.read_text())['currentReferences']), 1)

    def test_complete_upgrade_retirement_and_replay(self):
        old, old_path, old_side = self.source('pack')
        new, new_path, new_side = self.source('upgrade')
        self.file(1, new)
        self.file(2, new)
        before = self.run_cli(self.snapshot())
        self.assertEqual(before.returncode, 0, before.stderr)
        self.assertTrue(old_path.exists())
        result = self.run_cli(self.snapshot(), True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(old_path.exists())
        self.assertFalse(old_side.exists())
        self.assertTrue((self.retired / old_path.relative_to(self.archive)).exists())
        self.assertEqual(json.loads(new_side.read_text())['schemaVersion'], 2)
        self.assertEqual(len(json.loads(new_side.read_text())['importedFiles']), 2)
        self.assertEqual(new_path.name, 'upgrade.torrent')
        self.assertEqual(self.run_cli(self.snapshot(), True).returncode, 0)
        self.assertTrue((self.retired / old_path.relative_to(self.archive)).exists())

    def test_missing_provenance_proposal_previews_without_writing_but_apply_rejects(self):
        _, old_path, old_side = self.source('pack')
        new, new_path, new_side = self.source('upgrade')
        self.file(1, new)
        doc = json.loads(new_side.read_text())
        new_side.unlink()
        self.sources[1]['proposedSidecar'] = doc
        self.sources[1]['sidecarSha256'] = hashlib.sha256(
            (json.dumps(doc, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
        before = {p: p.read_bytes() for p in (old_path, old_side, new_path)}
        dry = self.run_cli(self.snapshot())
        self.assertEqual(dry.returncode, 0, dry.stdout + dry.stderr)
        self.assertEqual(json.loads(dry.stdout),
                         {'blocked': 0, 'current': 1, 'retired': 0, 'planned': 1, 'replay': 0})
        self.assertEqual({p: p.read_bytes() for p in before}, before)
        self.assertFalse(new_side.exists())
        self.assertEqual(list(self.retired.iterdir()), [])

        applied = self.run_cli(self.snapshot(), True)
        self.assertTrue(applied.returncode != 0 or json.loads(applied.stdout)['blocked'])
        self.assertTrue(old_path.exists())
        self.assertFalse(new_side.exists())

    def test_existing_provenance_ignores_proposal(self):
        h, path, side = self.source('pack')
        self.file(1, h)
        self.sources[0]['proposedSidecar'] = {'service': 'radarr', 'downloadId': 'F' * 40}
        dry = self.run_cli(self.snapshot())
        self.assertEqual(dry.returncode, 0, dry.stdout + dry.stderr)
        self.assertEqual(json.loads(dry.stdout)['current'], 1)
        self.assertTrue(path.exists())
        self.assertEqual(json.loads(side.read_text())['service'], 'sonarr')

        # A valid proposed document must not override wrong existing evidence.
        good_doc = json.loads(side.read_text())
        side.write_text('{"service":"radarr"}')
        self.sources[0]['proposedSidecar'] = good_doc
        self.sources[0]['sidecarSha256'] = hashlib.sha256(
            (json.dumps(good_doc, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
        wrong_disk = self.run_cli(self.snapshot())
        self.assertEqual(json.loads(wrong_disk.stdout)['blocked'], 1)

    def test_proposal_digest_mismatch_and_wrong_association_block_preview(self):
        h, path, side = self.source('pack')
        self.file(1, h)
        doc = json.loads(side.read_text())
        side.unlink()
        self.sources[0]['proposedSidecar'] = doc
        # The declared digest of the old noncanonical on-disk JSON is not the
        # digest of the proposed canonical representation.
        mismatch = self.run_cli(self.snapshot())
        self.assertEqual(json.loads(mismatch.stdout)['blocked'], 1)
        doc['downloadId'] = 'F' * 40
        self.sources[0]['proposedSidecar'] = doc
        self.sources[0]['sidecarSha256'] = hashlib.sha256(
            (json.dumps(doc, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
        wrong = self.run_cli(self.snapshot())
        self.assertEqual(json.loads(wrong.stdout)['blocked'], 1)
        self.assertTrue(path.exists())
        self.assertFalse(side.exists())

    def test_all_guards_block_retirement(self):
        old, path, _ = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, new)
        for index, change in enumerate(({'complete': False}, {'inventoryComplete': False}, {'importsComplete': False}, {'inventoryStable': False}, {'available': False},
                       {'currentFiles': []}, {'currentFiles': [{**self.files[0], 'downloadHash': None}]},
                       {'currentFiles': [{**self.files[0], 'mediaPath': str(self.base / 'missing')}]},
                       {'currentFiles': [{**self.files[0], 'downloadHash': 'C' * 40}]},
                       {'archiveSources': [self.sources[0]]}), start=1):
            with self.subTest(change=change):
                self.run_cli(self.snapshot(sequence=index, **change), True)
                self.assertTrue(path.exists())
        # A mismatched provenance digest is not proof.
        self.sources[0]['sidecarSha256'] = '0' * 64
        self.run_cli(self.snapshot(sequence=20), True)
        self.assertTrue(path.exists())

    def test_stale_sequence_does_not_retire_after_newer_observation(self):
        old, path, _ = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, old)
        self.assertEqual(self.run_cli(self.snapshot(sequence=20), True).returncode, 0)
        self.files[0]['downloadHash'] = new
        self.run_cli(self.snapshot(sequence=19), True)
        self.assertTrue(path.exists())

    def test_path_alias_symlink_and_collision_fail_closed(self):
        old, path, _ = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, new)
        for value in ('../escape.torrent', 'TV Shows/Show/../pack.torrent', '/etc/passwd'):
            self.sources[0]['path'] = value
            self.assertNotEqual(self.run_cli(self.snapshot(), True).returncode, 0)
            self.assertTrue(path.exists())
        self.sources[0]['path'] = str(path.relative_to(self.archive))
        alias = self.base / 'alias'
        alias.symlink_to(self.retired, target_is_directory=True)
        self.assertNotEqual(self.run_cli(self.snapshot(), True, retired=alias).returncode, 0)
        self.assertTrue(path.exists())
        collision = self.retired / path.relative_to(self.archive)
        collision.parent.mkdir(parents=True)
        collision.write_bytes(b'foreign')
        self.assertNotEqual(self.run_cli(self.snapshot(), True).returncode, 0)
        self.assertTrue(path.exists())

    def test_changed_or_symlinked_media_blocks_retirement(self):
        old, path, _ = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, new)
        media = Path(self.files[0]['mediaPath'])
        media.write_bytes(b'changed')
        self.run_cli(self.snapshot(), True)
        self.assertTrue(path.exists())
        media.unlink()
        outside = self.base / 'elsewhere'
        outside.write_bytes(b'current library file')
        media.symlink_to(outside)
        self.run_cli(self.snapshot(sequence=2), True)
        self.assertTrue(path.exists())

    def test_symlink_and_wrong_hash_evidence_never_retire(self):
        old, path, side = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, new)
        outside = self.base / 'outside'
        outside.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(outside)
        self.assertNotEqual(self.run_cli(self.snapshot(), True).returncode, 0)
        path.unlink()
        path.write_bytes(outside.read_bytes())
        self.sources[0]['hash'] = 'F' * 40
        self.run_cli(self.snapshot(), True)
        self.assertTrue(path.exists())
        self.sources[0]['hash'] = old
        side.write_text('{"service":"sonarr","arrItemId":"7","downloadId":"WRONG"}')
        self.run_cli(self.snapshot(), True)
        self.assertTrue(path.exists())

    def test_instance_isolation_and_same_name_distinct_sources(self):
        old, path, _ = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, new)
        self.run_cli(self.snapshot(instance='sonarr4k'), True)
        self.assertTrue(path.exists())
        self.assertEqual(self.run_cli(self.snapshot(), True).returncode, 0)
        self.assertFalse(path.exists())

    def test_concurrent_apply_one_retirement(self):
        old, path, _ = self.source('pack')
        new, _, _ = self.source('upgrade')
        self.file(1, new)
        p = self.base / 'snapshot.json'
        p.write_text(json.dumps(self.snapshot()))
        cmd = [sys.executable, str(SCRIPT), '--snapshot', str(p), '--archive-root', str(self.archive),
               '--retired-root', str(self.retired), '--apply']
        a = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        b = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(a.communicate()[0] and a.returncode, 0)
        self.assertEqual(b.communicate()[0] and b.returncode, 0)
        self.assertFalse(path.exists())

    def test_same_hash_keeps_original_name_and_retains_duplicate_bytes(self):
        h, preferred, side = self.source('pack')
        duplicate = preferred.with_name('pack-' + 'f' * 8 + '.torrent')
        duplicate.write_bytes(preferred.read_bytes())
        dup_side = duplicate.with_suffix('.provenance.json')
        doc = json.loads(side.read_text()); doc['torrentFile'] = duplicate.name
        dup_side.write_text(json.dumps(doc))
        self.sources.append({**self.sources[0], 'path': str(duplicate.relative_to(self.archive)),
                             'sidecarPath': str(dup_side.relative_to(self.archive)),
                             'sidecarSha256': hashlib.sha256(dup_side.read_bytes()).hexdigest()})
        self.file(1, h); self.file(2, h)
        original = duplicate.read_bytes()
        dry = self.run_cli(self.snapshot())
        self.assertEqual(json.loads(dry.stdout)['planned'], 1)
        result = self.run_cli(self.snapshot(), True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)['current'], 1)
        self.assertEqual(json.loads(result.stdout)['retired'], 1)
        self.assertTrue(preferred.exists()); self.assertFalse(duplicate.exists())
        self.assertEqual((self.retired / duplicate.relative_to(self.archive)).read_bytes(), original)
        self.assertEqual(len(json.loads(side.read_text())['currentReferences']), 2)
        self.assertEqual(self.run_cli(self.snapshot(), True).returncode, 0)

    def test_nested_private_retired_is_excluded_from_inventory(self):
        h, preferred, _ = self.source('pack')
        self.file(1, h)
        nested = self.archive / '.retired'; nested.mkdir()
        hidden = nested / 'TV Shows/Show/Season 01/hidden.torrent'
        hidden.parent.mkdir(parents=True); hidden.write_bytes(b'not source evidence')
        self.sources.append({**self.sources[0], 'path': str(hidden.relative_to(self.archive)),
                             'sidecarPath': str(hidden.with_suffix('.provenance.json').relative_to(self.archive))})
        result = self.run_cli(self.snapshot(), True, retired=nested)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)['current'], 1)
        self.assertTrue(preferred.exists())
        other = self.archive / 'TV Shows'; other.mkdir(exist_ok=True)
        self.assertNotEqual(self.run_cli(self.snapshot(sequence=2), retired=other).returncode, 0)

    def test_hardlinked_media_is_valid_current_file(self):
        h, preferred, _ = self.source('pack')
        _, old_path, _ = self.source('old')
        self.file(1, h)
        os.link(self.files[0]['mediaPath'], self.base / 'second-media-link')
        result = self.run_cli(self.snapshot(), True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(preferred.exists()); self.assertFalse(old_path.exists())

    def test_destination_collision_does_not_publish_current_sidecar(self):
        h, _, side = self.source('pack')
        _, old_path, _ = self.source('old')
        self.file(1, h)
        dst = self.retired / old_path.relative_to(self.archive)
        dst.parent.mkdir(parents=True); dst.write_bytes(b'foreign bytes')
        before = side.read_bytes()
        self.assertNotEqual(self.run_cli(self.snapshot(), True).returncode, 0)
        self.assertEqual(side.read_bytes(), before)
        self.assertTrue(old_path.exists()); self.assertEqual(dst.read_bytes(), b'foreign bytes')

    def test_resume_orphan_sidecar_and_interrupted_exclusive_link(self):
        h, _, _ = self.source('new')
        _, old_path, old_side = self.source('old')
        self.file(1, h)
        dst = self.retired / old_path.relative_to(self.archive)
        dst.parent.mkdir(parents=True)
        dst_side = dst.with_suffix('.provenance.json')
        dst_side.write_bytes(old_side.read_bytes())  # crash after sidecar publication
        first = self.run_cli(self.snapshot(), True)
        self.assertEqual(first.returncode, 0, first.stdout)
        self.assertFalse(old_path.exists())
        self.assertEqual(dst.read_bytes(), torrent('old'))

        # A crash between exclusive link and source unlink must fail closed:
        # archive evidence with two links is not eligible for retirement.
        h2, _, _ = self.source('another')
        _, stale_path, stale_side = self.source('stale')
        self.sources.pop(0)  # first preferred sidecar was updated by prior apply
        self.files[0]['downloadHash'] = h2
        linked_dst = self.retired / stale_path.relative_to(self.archive)
        linked_dst.parent.mkdir(parents=True, exist_ok=True)
        linked_dst.with_suffix('.provenance.json').write_bytes(stale_side.read_bytes())
        os.link(stale_path, linked_dst)
        result = self.run_cli(self.snapshot(sequence=2), True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(stale_path.exists())
        self.assertEqual(linked_dst.read_bytes(), torrent('stale'))


if __name__ == '__main__':
    unittest.main()
