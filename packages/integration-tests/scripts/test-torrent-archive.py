#!/usr/bin/env python3
"""Portable archive-hook fixtures; hook itself never needs Python."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HOOK = Path(__file__).resolve().parents[3] / 'stackarr/scripts/hooks/archive-torrent.sh'
VERIFY = HOOK.with_name('torrent-verify.sh')


def bencode(value):
    if isinstance(value, int): return b'i' + str(value).encode() + b'e'
    if isinstance(value, str): value = value.encode()
    if isinstance(value, bytes): return str(len(value)).encode() + b':' + value
    if isinstance(value, list): return b'l' + b''.join(map(bencode, value)) + b'e'
    return b'd' + b''.join(bencode(k) + bencode(v) for k, v in sorted(value.items())) + b'e'


def torrent(*paths, announce='https://private.invalid/passkey'):
    info = {'name': 'Test', 'piece length': 16384, 'pieces': b'X' * 20,
            'files': [{'length': 1, 'path': path.split('/')} for path in paths]}
    return bencode({'announce': announce, 'info': info})


def infohash(data):
    start = data.index(b'4:info') + len(b'4:info')
    return hashlib.sha1(data[start:-1]).hexdigest().upper()


HASH = infohash(torrent('Feature.mkv'))
OTHER = infohash(torrent('Other.mkv'))


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'archive'
        self.client = self.root / 'transmission'
        self.client.mkdir()
        self.naming = self.root / 'naming.json'
        self.naming.write_text(json.dumps({'seasonFolderFormat': 'Season {season:00}', 'specialsFolderFormat': 'Specials'}))
        self.env = {'TORRENT_ARCHIVE_ROOT': str(self.archive),
                    'TORRENT_SONARR_NAMING_CONFIG': str(self.naming),
                    'TRANSMISSION_TORRENT_STATE_DIR': str(self.client),
                    'QBITTORRENT_TORRENT_STATE_DIR': str(self.root / 'qb')}

    def run_hook(self, **env):
        return subprocess.run(['sh', str(HOOK)], env={**os.environ, **self.env, **env},
                              capture_output=True, text=True)

    def source(self, data):
        hash_ = infohash(data)
        (self.client / (hash_ + '.torrent')).write_bytes(data)
        return hash_

    def movie(self, hash_, event='Download', **kwargs):
        return self.run_hook(radarr_eventtype=event, radarr_download_id=hash_,
                             radarr_moviefile_path='/movies/Film/Feature.mkv',
                             radarr_release_title='Release', radarr_movie_id='42', **kwargs)

    def test_grab_stub_metadata_download_recovers_private_bytes(self):
        data = torrent('Feature.mkv'); hash_ = infohash(data)
        stub = b'd8:announce4:stub4:infodee'
        client = self.client / (hash_ + '.torrent'); client.write_bytes(stub)
        grab = self.movie(hash_, 'Grab'); self.assertEqual(grab.returncode, 0, grab.stderr)
        stage = self.archive / '_Unresolved/radarr' / (hash_ + '.torrent')
        self.assertFalse(stage.exists())
        stage.write_bytes(stub)  # Prior poisoned installation.
        client.write_bytes(data)
        download = self.movie(hash_); self.assertEqual(download.returncode, 0, download.stderr)
        self.assertEqual(stage.read_bytes(), data)
        self.assertEqual((self.archive / 'Movies/Film/Release.torrent').read_bytes(), data)
        rejected = list((self.archive / '.metadata/_Rejected/radarr').glob('*.torrent'))
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0].read_bytes(), stub)
        self.assertEqual(json.loads((self.archive / '_Pending/radarr/42.json').read_text())['downloadId'], hash_)

    def test_captured_beats_stub_and_existing_verified_wrapper_wins(self):
        data = torrent('Feature.mkv'); hash_ = infohash(data)
        (self.client / (hash_ + '.torrent')).write_bytes(b'bad stub')
        captured = self.archive / '.metadata/_Captured'; captured.mkdir(parents=True)
        (captured / (hash_ + '.torrent')).write_bytes(data)
        self.assertEqual(self.movie(hash_).returncode, 0)
        target = self.archive / 'Movies/Film/Release.torrent'
        self.assertEqual(target.read_bytes(), data)
        (captured / (hash_ + '.torrent')).unlink()
        (self.client / (hash_ + '.torrent')).write_bytes(torrent('Feature.mkv', announce='https://second.invalid'))
        self.assertEqual(self.movie(hash_).returncode, 0)
        self.assertEqual(target.read_bytes(), data)
        self.assertEqual(list(target.parent.glob('*.torrent')), [target])

    def test_primary_poison_recovers_and_distinct_verified_collision_preserved(self):
        data = torrent('Feature.mkv'); hash_ = self.source(data)
        primary = self.archive / 'Movies/Film/Release.torrent'; primary.parent.mkdir(parents=True)
        primary.write_bytes(b'stub')
        self.assertEqual(self.movie(hash_).returncode, 0)
        self.assertEqual(primary.read_bytes(), data)
        other = torrent('Other.mkv'); other_hash = self.source(other)
        self.assertEqual(self.movie(other_hash).returncode, 0)
        self.assertEqual(primary.read_bytes(), data)
        self.assertEqual((primary.parent / f'Release [{other_hash}].torrent').read_bytes(), other)

    def test_reject_hash_mismatch_stubs_and_nonmetainfo(self):
        wrong = infohash(torrent('Other.mkv'))
        for payload in (torrent('Feature.mkv'), b'not bencode', b'd4:infodee', b'd4:infod4:name4:Testeex'):
            with self.subTest(payload=payload):
                (self.client / (wrong + '.torrent')).write_bytes(payload)
                result = self.movie(wrong); self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse((self.archive / '_Unresolved/radarr' / (wrong + '.torrent')).exists())
                self.assertFalse((self.archive / 'Movies').exists())

    def test_unknown_client_prefers_verified_completed_over_stub(self):
        data = torrent('Feature.mkv'); hash_ = infohash(data)
        qb = self.root / 'qb'; qb.mkdir()
        (qb / (hash_ + '.torrent')).write_bytes(b'magnet stub')
        (self.client / (hash_ + '.torrent')).write_bytes(data)
        result = self.movie(hash_)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.archive / 'Movies/Film/Release.torrent').read_bytes(), data)

    def test_tv_classification_and_unicode_without_python(self):
        data = torrent('Show S02E01.mkv'); hash_ = self.source(data)
        bin_ = self.root / 'bin'; bin_.mkdir()
        for name in ('sh', 'jq', 'tr', 'wc', 'mkdir', 'mktemp', 'mv', 'cp', 'ln', 'rm',
                     'date', 'cmp', 'chmod', 'od', 'awk', 'dd', 'sha1sum', 'sha256sum', 'dirname', 'sed'):
            executable = shutil.which(name); assert executable, name
            (bin_ / name).symlink_to(executable)
        result = self.run_hook(sonarr_eventtype='Download', sonarr_download_id=hash_,
                               sonarr_release_title='Épisode.' * 35,
                               sonarr_episodefile_path='/tv/Show/Season 02/Show S02E01.mkv',
                               sonarr_episodefile_seasonnumber='2', PATH=str(bin_))
        self.assertEqual(result.returncode, 0, result.stderr)
        files = list((self.archive / 'TV Shows/Show/Season 02').glob('*.torrent'))
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].name.startswith('Épisode.'))
        self.assertLessEqual(len(files[0].name.encode()), 255)

    def test_symlink_source_and_stage_rejected(self):
        data = torrent('Feature.mkv'); hash_ = infohash(data)
        external = self.root / 'outside'; external.write_bytes(data)
        (self.client / (hash_ + '.torrent')).symlink_to(external)
        self.assertEqual(self.movie(hash_).returncode, 0)
        self.assertFalse((self.archive / 'Movies').exists())
        stage = self.archive / '_Unresolved/radarr' / (hash_ + '.torrent')
        stage.symlink_to(external)
        self.assertNotEqual(self.movie(hash_).returncode, 0)

    def test_verifier_raw_v1_v2_and_trailing_bytes(self):
        data = torrent('Feature.mkv'); file = self.root / 'verify.torrent'; file.write_bytes(data)
        self.assertEqual(subprocess.run(['sh', str(VERIFY), str(file), infohash(data)]).returncode, 0)
        file.write_bytes(data + b'x')
        self.assertNotEqual(subprocess.run(['sh', str(VERIFY), str(file), infohash(data)]).returncode, 0)
        info = bencode({'name': 'Test', 'meta version': 2, 'piece length': 16384,
                        'file tree': {'Feature.mkv': {'': {'length': 1, 'pieces root': b'Z' * 32}}}})
        file.write_bytes(b'd4:info' + info + b'e')
        self.assertEqual(subprocess.run(['sh', str(VERIFY), str(file), hashlib.sha256(info).hexdigest()]).returncode, 0)


if __name__ == '__main__': unittest.main()
