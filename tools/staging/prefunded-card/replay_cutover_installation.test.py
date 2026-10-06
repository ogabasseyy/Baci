import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('cutover_install', HERE / 'replay_cutover_installation.py')
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)
from replay_cutover_runtime import expected_container


class ReplayCutoverInstallation(unittest.TestCase):
    def test_start_records_heartbeat_lower_bound_before_docker_start(self):
        installer = object.__new__(INSTALL.Installer)
        installer.digest = 'a' * 64
        observed = expected_container(str(INSTALL.DIRECTORY), installer.digest, False)
        def command(arguments):
            self.assertEqual(installer.started_at_ms, 1790500000000)
            self.assertEqual(arguments[-2:], ['start', INSTALL.CONTAINER])
        with patch.object(INSTALL, 'inspect', return_value=observed), \
                patch.object(INSTALL, 'command', side_effect=command), \
                patch.object(INSTALL.time, 'time', return_value=1790500000):
            installer.start()

    def verify_fixture(self, heartbeats, timer='active', expired=False, legacy_running=False):
        installer = object.__new__(INSTALL.Installer)
        installer.digest = 'a' * 64
        installer.bundle = Path('/synthetic-bundle')
        installer.started_at_ms = 1790500000000
        observed = expected_container(str(INSTALL.DIRECTORY), installer.digest, False)
        observed.update(Id='candidate', State={'Running': True})
        values = iter(heartbeats)
        calls = []
        def command(arguments, **options):
            calls.append(arguments)
            if 'exec' in arguments:
                self.assertIn('--user=65532:65532', arguments)
                self.assertEqual(arguments[-3:-1], ['node', '-e'])
                self.assertIn('/tmp/replay-heartbeat', arguments[-1])
                self.assertLessEqual(options['timeout'], 5)
                return next(values)
            self.assertEqual(arguments, ['/usr/bin/systemctl', 'is-active',
                                         'baci-prefunded-replay-deadline.timer'])
            return timer
        def inspect(name):
            return observed if name == INSTALL.CONTAINER else {'State': {'Running': legacy_running}}
        with patch.object(INSTALL, 'inspect', side_effect=inspect), \
                patch.object(INSTALL, 'command', side_effect=command), \
                patch.object(INSTALL, 'write_private') as write, \
                patch.object(INSTALL.time, 'sleep'), \
                patch.object(INSTALL.time, 'time', return_value=1790500000.5), \
                patch.object(INSTALL.time, 'monotonic', side_effect=([0, 0, 46] if expired else None),
                             return_value=0):
            if expired or timer != 'active' or legacy_running:
                with self.assertRaises(INSTALL.Refused):
                    installer.verify()
                write.assert_not_called()
            else:
                installer.verify()
                write.assert_called_once()
        return calls

    def test_verify_waits_for_fresh_completed_pass_then_requires_active_timer(self):
        calls = self.verify_fixture(['', '1790499999999', '1790500000501', 'secret', '1790500000000'])
        self.assertEqual(sum('exec' in arguments for arguments in calls), 5)
        self.assertIn('is-active', calls[-1])

    def test_verify_never_publishes_success_without_fresh_heartbeat_and_active_timer(self):
        self.verify_fixture([''], expired=True)
        self.verify_fixture(['1790500000500'], timer='inactive')
        self.verify_fixture([], legacy_running=True)

    def run_readiness(self, stdout='', stderr='', code=0):
        script = (f'import sys; sys.stdout.write({stdout!r}); sys.stderr.write({stderr!r}); '
                  f'raise SystemExit({code})')
        with patch.object(INSTALL, 'DOCKER', [sys.executable, '-B', '-c', script]):
            object.__new__(INSTALL.Installer).readiness()

    def test_readiness_preserves_only_fixed_receiver_failure_stages(self):
        for stage in ('configuration', 'prefunded-runtime', 'receipt-database', 'app-database', 'readiness'):
            report = json.dumps(dict(status='replay-runtime-not-ready', readOnly=True, stage=stage))
            with self.subTest(stage=stage):
                with self.assertRaises(INSTALL.Refused) as caught:
                    self.run_readiness(stderr=report, code=1)
                self.assertEqual(str(caught.exception), 'Restricted replay readiness refused: stage=' + stage)

    def test_readiness_requires_exact_success_and_redacts_unknown_failures(self):
        success = json.dumps(dict(status='replay-runtime-ready', readOnly=True))
        self.run_readiness(stdout=success)
        for stdout, stderr, code in (
            (success, 'secret', 0), (success, '', 1),
            ('{"status":"secret","status":"replay-runtime-ready","readOnly":true}', '', 0),
            ('', '[' * 4000 + ']' * 4000, 1),
            (json.dumps(dict(status='replay-runtime-ready', readOnly=1)), '', 0),
            (json.dumps(dict(status='replay-runtime-ready', readOnly=True, secret='secret')), '', 0),
            ('', json.dumps(dict(status='replay-runtime-not-ready', readOnly=True, stage='secret')), 1),
            ('', json.dumps(dict(status='replay-runtime-not-ready', readOnly=True,
                                stage='configuration', secret='secret')), 1),
            ('', json.dumps(dict(status='replay-runtime-not-ready', readOnly=1, stage='configuration')), 1),
            ('secret', 'secret', 1), ('', 'secret', 125),
        ):
            with self.subTest(code=code):
                with self.assertRaises(INSTALL.Refused) as caught:
                    self.run_readiness(stdout=stdout, stderr=stderr, code=code)
                self.assertEqual(str(caught.exception), 'Restricted replay readiness did not pass')

    def test_readiness_caps_combined_output_before_parsing_even_valid_json(self):
        success = json.dumps(dict(status='replay-runtime-ready', readOnly=True))
        for stdout, stderr in ((success + ' ' * 8192, ''), ('', 'x' * 131072),
                               (success + ' ' * 5000, ' ' * 5000)):
            with self.subTest(stdout_length=len(stdout)):
                with self.assertRaises(INSTALL.Refused) as caught:
                    self.run_readiness(stdout=stdout, stderr=stderr)
                self.assertEqual(str(caught.exception), 'Restricted replay readiness did not pass')

    def test_readiness_timeout_is_redacted_and_reaps_local_checker(self):
        with patch.object(INSTALL.time, 'monotonic', side_effect=[0, 46]):
            with self.assertRaises(INSTALL.Refused) as caught:
                self.run_readiness(stdout='secret', stderr='secret')
        self.assertEqual(str(caught.exception), 'Restricted replay readiness did not pass')

    def test_new_directory_is_accessible_under_owner_umask_without_repairing_existing(self):
        actual_lstat, actual_fstat = Path.lstat, os.fstat
        def owner_metadata(metadata):
            fields = list(metadata)
            fields[4:6] = [0, 65532]
            return os.stat_result(fields)
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(INSTALL, 'root_ancestors'), \
                patch.object(Path, 'lstat', lambda path: owner_metadata(actual_lstat(path))), \
                patch.object(os, 'fstat', lambda descriptor: owner_metadata(actual_fstat(descriptor))), \
                patch.object(os, 'chown'), patch.object(os, 'fchown'):
            path = Path(temporary) / 'new'
            previous = os.umask(0o077)
            try:
                INSTALL.directory(path)
                self.assertEqual(path.stat().st_mode & 0o777, 0o750)
                inode = path.stat().st_ino
                INSTALL.directory(path)
                self.assertEqual(path.stat().st_ino, inode)
                path.chmod(0o700)
                with self.assertRaises(INSTALL.Refused):
                    INSTALL.directory(path)
                self.assertEqual(path.stat().st_mode & 0o777, 0o700)
                (Path(temporary) / 'link').symlink_to(path)
                with self.assertRaises(INSTALL.Refused):
                    INSTALL.directory(Path(temporary) / 'link')
            finally:
                os.umask(previous)

    def test_identical_commit_marker_retry_does_not_block_recovery(self):
        installer = object.__new__(INSTALL.Installer)
        installer.digest = 'a' * 64
        actual_lstat = Path.lstat
        def root_group(path):
            fields = list(actual_lstat(path))
            fields[5] = 0
            return os.stat_result(fields)
        with tempfile.TemporaryDirectory() as temporary, patch.object(INSTALL.os, 'fchown'), \
                patch.object(Path, 'lstat', root_group):
            installer.bundle = Path(temporary)
            installer.record_commit()
            path = installer.bundle / 'enrollment-commit.json'
            inode = path.stat().st_ino
            installer.record_commit()
            self.assertEqual(path.stat().st_ino, inode)
            installer.digest = 'b' * 64
            with self.assertRaises(INSTALL.Refused):
                installer.record_commit()

    def test_exact_file_retry_preserves_inode_and_refuses_foreign_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'config.json'
            INSTALL.place_file(path, b'private', 0o440, os.getgid())
            before = path.stat()
            INSTALL.place_file(path, b'private', 0o440, os.getgid())
            self.assertEqual(path.stat().st_ino, before.st_ino)
            with self.assertRaises(INSTALL.Refused):
                INSTALL.place_file(path, b'changed', 0o440, os.getgid())
            self.assertEqual(path.read_bytes(), b'private')

    def test_symlink_hardlink_and_wrong_mode_are_not_repaired(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / 'real'
            INSTALL.place_file(real, b'private', 0o440, os.getgid())
            (root / 'symlink').symlink_to(real)
            with self.assertRaises(INSTALL.Refused):
                INSTALL.place_file(root / 'symlink', b'private', 0o440, os.getgid())
            os.link(real, root / 'hardlink')
            with self.assertRaises(INSTALL.Refused):
                INSTALL.place_file(real, b'private', 0o440, os.getgid())
            (root / 'hardlink').unlink()
            real.chmod(0o640)
            with self.assertRaises(INSTALL.Refused):
                INSTALL.place_file(real, b'private', 0o440, os.getgid())

    def test_deadline_only_stops_new_worker_at_fixed_time(self):
        self.assertIn('OnCalendar=2026-09-29 15:59:10 UTC', INSTALL.TIMER)
        self.assertIn('stop --time 15 pvb-staging-replay-prefunded', INSTALL.STOPPER)
        self.assertNotIn('restart', INSTALL.STOPPER)
        self.assertNotIn('[Install]', INSTALL.TIMER)

    def test_partial_network_retry_refuses_before_readiness_or_reconnection(self):
        installer = object.__new__(INSTALL.Installer)
        installer.digest = 'a' * 64
        observed = expected_container(str(INSTALL.DIRECTORY), installer.digest, True)
        observed['NetworkSettings']['Networks'].pop(INSTALL.NETWORKS[-1])
        with patch.object(INSTALL, 'command', return_value='existing-id') as command, \
                patch.object(INSTALL, 'inspect', return_value=observed):
            with self.assertRaises(INSTALL.Refused):
                installer.container(True)
        self.assertEqual(command.call_count, 1)
        self.assertIn('ps', command.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
