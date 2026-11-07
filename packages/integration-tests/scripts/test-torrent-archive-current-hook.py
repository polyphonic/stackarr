#!/usr/bin/env python3
"""Current-source trigger and delayed-metadata hook regression fixtures."""
import json
import runpy
import shutil
from pathlib import Path
import unittest

fixtures = runpy.run_path(str(Path(__file__).with_name('test-torrent-archive.py')))
Fixture = fixtures['ArchiveTest']
HASH = fixtures['HASH']
OTHER = fixtures['OTHER']
torrent = fixtures['torrent']
infohash = fixtures['infohash']


class CurrentHookTests(unittest.TestCase):
    root: Path
    archive: Path
    client: Path
    setUp = Fixture.setUp
    run_hook = Fixture.run_hook

    def values(self, **overrides):
        return dict(radarr_eventtype='Download', radarr_download_id=HASH,
                    radarr_movie_id='42', radarr_moviefile_id='101',
                    radarr_moviefile_path='/movies/Film/Feature.mkv',
                    radarr_release_title='Original.Release', **overrides)

    def test_import_without_metadata_still_requests_reconciliation(self):
        result = self.run_hook(**self.values())
        self.assertEqual(result.returncode, 0, result.stderr)
        request = self.archive / '_Pending/radarr/42.json'
        data = json.loads(request.read_text())
        self.assertEqual(data['downloadId'], HASH)
        self.assertFalse((self.archive / 'Movies').exists())
        values = self.values()
        values['radarr_download_id'] = OTHER
        self.assertEqual(self.run_hook(**values).returncode, 0)
        self.assertEqual(json.loads(request.read_text())['downloadId'], OTHER)

    def test_cached_metadata_survives_downloader_removal(self):
        captured = self.archive / '.metadata/_Captured'
        captured.mkdir(parents=True)
        content = torrent('Feature.mkv')
        (captured / (HASH + '.torrent')).write_bytes(content)
        result = self.run_hook(**self.values())
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.archive / 'Movies/Film/Original.Release.torrent'
        self.assertEqual(target.read_bytes(), content)
        self.assertEqual(json.loads(target.with_suffix('.provenance.json').read_text())['instance'], 'radarr')

    def test_long_unicode_titles_remain_identifiable_without_python(self):
        commands = self.root / 'bin'
        commands.mkdir()
        for command in ('sh', 'jq', 'tr', 'wc', 'mkdir', 'mktemp', 'mv', 'cp', 'ln', 'rm', 'date', 'cmp', 'chmod', 'od', 'awk', 'dd', 'sha1sum', 'sha256sum', 'dirname', 'sed'):
            executable = shutil.which(command)
            assert executable is not None, command
            (commands / command).symlink_to(executable)
        (self.client / (HASH + '.torrent')).write_bytes(torrent('Feature.mkv'))
        title = 'Release.' + '字幕' * 70
        values = self.values()
        values['radarr_release_title'] = title
        result = self.run_hook(**values, PATH=str(commands))
        self.assertEqual(result.returncode, 0, result.stderr)
        files = list((self.archive / 'Movies/Film').glob('*.torrent'))
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].stem.startswith('Release.字幕'))
        self.assertLessEqual(len(files[0].stem.encode()), 140)

    def test_instances_are_separate_and_invalid_instance_is_rejected(self):
        result = self.run_hook(**self.values(), TORRENT_ARR_INSTANCE='radarr4k')
        self.assertEqual(result.returncode, 0)
        self.assertTrue((self.archive / '_Pending/radarr4k/42.json').is_file())
        self.assertFalse((self.archive / '_Pending/radarr/42.json').exists())
        result = self.run_hook(**self.values(), TORRENT_ARR_INSTANCE='../escape')
        self.assertNotEqual(result.returncode, 0)

    def test_grab_does_not_request_retirement(self):
        values = self.values()
        values['radarr_eventtype'] = 'Grab'
        self.assertEqual(self.run_hook(**values).returncode, 0)
        self.assertFalse((self.archive / '_Pending').exists())


if __name__ == '__main__':
    del Fixture
    unittest.main()
