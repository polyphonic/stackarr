#!/usr/bin/env python3
"""Static config-path regression tests; never starts Docker containers."""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
COMPOSE = REPO / 'stackarr/docker-compose.yml'
COMMON = REPO / 'stackarr/lib/common.sh'


class TorrentArchiveConfigTest(unittest.TestCase):
    def render(self, **overrides):
        env = {"PATH": os.environ["PATH"], "HOME": "/home/test",
               "APP_ROOT": "/stackarr", "STATE_ROOT": "/stackarr/state",
               "CONFIG_ROOT": "/stackarr/config", **overrides}
        result = subprocess.run(
            ['docker-compose', '-f', str(COMPOSE), '--profile', 'stackarr', '--profile', 'movies',
             '--profile', 'tv', '--profile', 'radarr4k', '--profile', 'sonarr4k',
             'config', '--format', 'json'], env=env, cwd=REPO,
            capture_output=True, text=True, check=True)
        return json.loads(result.stdout)['services']

    def assert_mounts(self, services, archive, config):
        for name in ('radarr', 'radarr4k', 'sonarr', 'sonarr4k'):
            mounts = {m['target']: m['source'] for m in services[name]['volumes'] if m['type'] == 'bind'}
            self.assertEqual(mounts['/torrent-archive'], archive, name)
            self.assertEqual(mounts['/stackarr-hooks'], f'{config}/hooks', name)
            self.assertEqual(mounts['/torrent-client-state/transmission'], f'{config}/transmission/torrents', name)
            self.assertEqual(mounts['/torrent-client-state/qbittorrent'], f'{config}/qbittorrent/qBittorrent/BT_backup', name)
            self.assertEqual(mounts['/config'], f'{config}/{name}', name)

    def test_default_and_relocated_config(self):
        self.assert_mounts(self.render(), '/stackarr/state/torrent-archive', '/stackarr/config')
        self.assert_mounts(self.render(CONFIG_ROOT='/external/config'), '/stackarr/state/torrent-archive', '/external/config')

    def test_custom_archive_and_state(self):
        services = self.render(STATE_ROOT='/internal/state', CONFIG_ROOT='/external/config',
                               TORRENT_ARCHIVE_ROOT='/external/downloads/torrent-archive')
        self.assert_mounts(services, '/external/downloads/torrent-archive', '/external/config')
        app = {m['target']: m for m in services['app']['volumes'] if m['type'] == 'bind'}
        self.assertEqual(app['/external/downloads/torrent-archive']['source'], '/external/downloads/torrent-archive')
        # Configure and restore must be able to provision this mounted archive.
        self.assertFalse(app['/external/downloads/torrent-archive'].get('read_only', False))
        self.assert_mounts(self.render(STATE_ROOT='/internal/state'), '/internal/state/torrent-archive', '/stackarr/config')

    def test_shell_default_and_custom_export(self):
        for setting, expected in [('', '/internal/state/torrent-archive'),
                                  ('TORRENT_ARCHIVE_ROOT=/archive', '/archive')]:
            result = subprocess.run(['bash', '-c', f'''source "{COMMON}"; APP_ROOT=/stackarr STATE_ROOT=/internal/state; {setting or ':'}; load_env; printf '%s' "$TORRENT_ARCHIVE_ROOT"'''],
                                    env={'PATH': os.environ['PATH'], 'HOME': '/home/test'},
                                    capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout, expected)

    def test_external_path_fails_closed_without_enrollment(self):
        command = f'''source "{COMMON}"; TORRENT_ARCHIVE_ROOT=/Volumes/unmounted/torrent-archive; stackarr_verify_torrent_archive_root'''
        result = subprocess.run(['bash', '-c', command], env={'PATH': os.environ['PATH'], 'HOME': '/home/test'},
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing enrollment', result.stderr)


if __name__ == '__main__':
    unittest.main()
