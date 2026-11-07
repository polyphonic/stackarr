#!/usr/bin/env python3
"""Offline worker wiring fixtures. Never connects to native services."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parents[3] / 'stackarr/scripts'


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'lib').mkdir()
        self.archive = self.root / 'archive'
        self.archive.mkdir()
        for name in ('torrent-archive-worker.sh', 'torrent-metadata-capture.py'):
            shutil.copyfile(SOURCE / name, self.root / 'scripts' / name)
        (self.root / 'lib/common.sh').write_text('''
load_env() { :; }
optional_service_enabled() { return 0; }
flag_enabled() { [[ "$1" == true ]]; }
stackarr_storage_guard() { [[ "${DENY_GUARD:-0}" == 0 ]]; }
stackarr_verify_torrent_archive_root() { return 0; }
service_url() { printf '%s\\n' "$2"; }
''')
        (self.root / 'scripts/torrent-current-inventory.py').write_text('''
import json,os,sys
from pathlib import Path
with Path(os.environ['CALLS']).open('a') as f:
 f.write(json.dumps({'args':sys.argv[1:], 'uid':os.getuid()})+'\\n')
''')
        self.env = {**os.environ, 'TORRENT_ARCHIVE_ROOT':str(self.archive),
                    'PUID':str(os.getuid()), 'PGID':str(os.getgid()),
                    'CONFIG_ROOT':str(self.root/'config'), 'MEDIA_ROOT':str(self.root/'media'),
                    'SONARR_URL':'http://fixture-sonarr', 'RADARR_URL':'http://fixture-radarr',
                    'CALLS':str(self.root/'calls'), 'ENABLE_4K_SERVARR':'false'}

    def run_worker(self, mode, **env):
        return subprocess.run(['bash', str(self.root/'scripts/torrent-archive-worker.sh'), mode],
                              env={**self.env, **env}, capture_output=True, text=True, timeout=15)

    def test_capture_creates_private_working_directories_as_media_owner(self):
        result = self.run_worker('--capture-once')
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ('.metadata', '.metadata/_Captured', '.retired'):
            info = (self.archive/name).stat()
            self.assertEqual(info.st_mode & 0o777, 0o700)
            self.assertEqual(info.st_uid, os.getuid())

    def test_mount_guard_failure_prevents_capture_writes(self):
        result = self.run_worker('--capture-once', DENY_GUARD='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.archive.iterdir()), [])

    def test_both_pending_instances_run_under_media_owner(self):
        for instance in ('sonarr','radarr'):
            pending = self.archive/'_Pending'/instance
            pending.mkdir(parents=True)
            (pending/'42.json').write_text('{}')
        result = self.run_worker('--current-once')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(x) for x in (self.root/'calls').read_text().splitlines()]
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call['uid'], os.getuid())
            self.assertIn('--apply', call['args'])
            self.assertIn('--pending', call['args'])

    def test_daemon_shutdown_stops_both_owned_helpers(self):
        version = subprocess.run(['bash', '-c', 'test "${BASH_VERSINFO[0]}" -ge 4'])
        if version.returncode:
            self.skipTest('daemon lifecycle requires the controller image Bash 4+')
        for name, kind in [('torrent-metadata-capture.py', 'capture'),
                           ('torrent-current-inventory.py', 'inventory')]:
            (self.root/'scripts'/name).write_text(
                'import os,time\nfrom pathlib import Path\n'
                f'Path(os.environ["READY"]+".{kind}").write_text(str(os.getpid()))\n'
                'time.sleep(60)\n')
        pending = self.archive/'_Pending/sonarr'
        pending.mkdir(parents=True)
        (pending/'42.json').write_text('{}')
        ready = str(self.root/'ready')
        process = subprocess.Popen(['bash', str(self.root/'scripts/torrent-archive-worker.sh')],
                                   env={**self.env, 'READY':ready}, start_new_session=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic()+8
            paths = [Path(ready+'.capture'), Path(ready+'.inventory')]
            while not all(p.exists() for p in paths) and time.monotonic() < deadline:
                time.sleep(0.03)
            self.assertTrue(all(p.exists() for p in paths), 'both workers must start')
            children = [int(p.read_text()) for p in paths]
            process.terminate()
            process.wait(timeout=5)
            def active(pid):
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    return False
                status = Path(f'/proc/{pid}/stat')
                return not status.exists() or status.read_text().split(') ', 1)[1][0] != 'Z'
            deadline = time.monotonic()+3
            while any(active(pid) for pid in children) and time.monotonic() < deadline:
                time.sleep(0.03)
            self.assertFalse(any(active(pid) for pid in children), 'helpers survived shutdown')
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)

    def test_shared_4k_scope_is_held_and_idle_worker_never_queries_api(self):
        self.assertEqual(self.run_worker('--current-once').returncode, 0)
        self.assertFalse((self.root/'calls').exists())
        pending = self.archive/'_Pending/sonarr'
        pending.mkdir(parents=True)
        (pending/'42.json').write_text('{}')
        result = self.run_worker('--current-once', ENABLE_4K_SERVARR='true')
        self.assertEqual(result.returncode, 0)
        self.assertIn('retirement held', result.stdout)
        self.assertFalse((self.root/'calls').exists())


if __name__ == '__main__':
    unittest.main()
