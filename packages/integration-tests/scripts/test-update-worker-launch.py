#!/usr/bin/env python3
"""Exercise the updater entrypoint with a Compose-2.27 contract boundary."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
COMMON = r'''
print_header() { :; }
load_env() { :; }
maintenance_lock_enter() { :; }
database_mode_is_postgres() { return 1; }
write_compose_env_file() { :; }
ensure_docker_runtime() { :; }
compose_profile_args() { :; }
warn() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
stackarr_compose() {
    printf '%s\n' "$*" >> "$FIXTURE_CALLS"
    case "$*" in
        *'run --pull'*) printf 'unknown flag: --pull\n' >&2; return 16 ;;
        *' pull '*) return "${FIXTURE_PULL_STATUS:-0}" ;;
        *' run '*) return "${FIXTURE_RUN_STATUS:-0}" ;;
        *) printf 'Unexpected Compose operation\n' >&2; return 19 ;;
    esac
}
'''

class WorkerLaunch(unittest.TestCase):
    def launch(self, **extra):
        with tempfile.TemporaryDirectory(prefix='stackarr-updater-contract-') as tmp:
            root = Path(tmp)
            (root/'scripts').mkdir()
            (root/'lib').mkdir()
            shutil.copyfile(REPO/'stackarr/scripts/update-run.sh', root/'scripts/update-run.sh')
            (root/'lib/common.sh').write_text(COMMON)
            calls = root/'calls'
            env = {'PATH': os.environ['PATH'], 'HOME': str(root), 'FIXTURE_CALLS': str(calls),
                   'STACKARR_IMAGE': 'example/stackarr:stable', 'STACKARR_TASK_ID': 'fixture-task', **extra}
            result = subprocess.run(['bash', str(root/'scripts/update-run.sh'), 'app'], env=env,
                                    text=True, capture_output=True, timeout=10)
            return result, calls.read_text().splitlines() if calls.exists() else []

    def test_pulls_worker_before_launch_and_never_starts_dependencies(self):
        result, calls = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['--profile maintenance pull --quiet app-updater',
                                '--profile maintenance run --no-deps -d --rm -e STACKARR_UPDATE_TASK_ID=fixture-task app-updater'])
        self.assertIn('STACKARR_UPDATE_HANDOFF_STARTED', result.stdout)

    def test_pull_failure_never_launches_or_recreates(self):
        result, calls = self.launch(FIXTURE_PULL_STATUS='17')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, ['--profile maintenance pull --quiet app-updater'])
        self.assertNotIn('STACKARR_UPDATE_HANDOFF_STARTED', result.stdout)

    def test_launch_failure_never_reports_handoff(self):
        result, calls = self.launch(FIXTURE_RUN_STATUS='18')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 2)
        self.assertNotIn('STACKARR_UPDATE_HANDOFF_STARTED', result.stdout)
        self.assertTrue(all(' up ' not in call for call in calls))

    def test_local_image_is_preserved(self):
        result, calls = self.launch(STACKARR_IMAGE='stackarr-local:local')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [])
        self.assertNotIn('STACKARR_UPDATE_HANDOFF_STARTED', result.stdout)

if __name__ == '__main__':
    unittest.main()
