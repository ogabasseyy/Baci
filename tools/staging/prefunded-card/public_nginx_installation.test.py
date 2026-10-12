import hashlib
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import public_nginx_installation as installation
from public_nginx_transform import render_config
from treasury_owner_contract import DEADLINE_EPOCH, Refused


BEFORE = b'server { listen 443 ssl; server_name staging-auth.ogabassey.com; location / { return 404; } }\n'
PIN = hashlib.sha256(BEFORE).hexdigest()
AFTER = render_config(BEFORE, PIN)


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.current = BEFORE
        self.metadata = Mock(st_dev=1, st_ino=2, st_uid=0, st_gid=0, st_nlink=1,
                             st_mode=stat.S_IFREG | 0o400, st_mtime_ns=123, st_ctime_ns=124,
                             st_atime_ns=122, st_size=len(BEFORE))
        self.installer = installation.PublicNginxInstaller(Path('/root/synthetic-audit'))
        self.baseline = Mock(return_value=True)

    def mocks(self):
        self.addCleanup(patch.stopall)
        for name, value in (('PREDECESSOR_SIZE', len(BEFORE)),):
            patch.object(installation, name, value).start()
        patch.object(installation.os, 'getuid', return_value=0).start()
        patch.object(installation.os, 'geteuid', return_value=0).start()
        patch.object(installation.time, 'time', return_value=DEADLINE_EPOCH - 60).start()
        patch.object(installation, 'root_ancestors').start()
        patch.object(installation, 'private_directory').start()
        patch.object(installation, '_read_target', side_effect=lambda: (self.current, self.metadata)).start()
        self.backup = patch.object(installation, 'write_private',
                                   side_effect=lambda *_: self.events.append('backup')).start()
        self.write = patch.object(installation, '_atomic_write', side_effect=self.atomic).start()
        self.command = patch.object(installation, '_command', side_effect=self.command_event).start()

    def atomic(self, content, metadata, expected_content, expected_metadata):
        installation._unchanged(expected_content, expected_metadata)
        self.events.append('restore' if content == BEFORE else 'replace')
        self.current = content

    def command_event(self, command):
        self.events.append('syntax' if command[-1] == '-t' else 'reload')

    def probe(self):
        self.events.append('probe')
        return True

    def install(self, postprobe):
        return self.installer.install(self.installer.preflight(), postprobe, baselineprobe=self.baseline)

    def test_root_preflight_pin_must_be_explicitly_passed_back_before_installation(self):
        self.mocks()
        with self.assertRaisesRegex(Refused, 'pin'):
            self.installer.install(PIN, self.probe, baselineprobe=self.baseline)
        self.assertEqual(self.installer.preflight(), PIN)
        for value in (None, '', '0' * 64, 'g' * 64, 1):
            with self.assertRaisesRegex(Refused, 'pin'):
                self.installer.install(value, self.probe, baselineprobe=self.baseline)
        self.assertEqual(self.events, [])

    def test_preflight_is_read_only_then_installs_and_probes_after_reload(self):
        self.mocks()
        self.installer.preflight()
        self.assertEqual(self.events, [])
        self.install(self.probe)
        self.assertEqual(self.events, ['backup', 'replace', 'syntax', 'reload', 'probe'])
        self.assertEqual(self.current, AFTER)
        self.assertEqual(self.baseline.call_count, 2)
        self.backup.assert_called_once_with(Path('/root/synthetic-audit/nginx-before.conf'), BEFORE)

    def test_syntax_reload_and_postprobe_failures_restore_original_and_reload(self):
        self.mocks()
        for failed in ('syntax', 'reload', 'probe'):
            with self.subTest(failed=failed):
                self.current, self.events = BEFORE, []
                self.installer = installation.PublicNginxInstaller(Path('/root/synthetic-audit'))
                raised = False

                def event(command):
                    nonlocal raised
                    self.command_event(command)
                    if self.events[-1] == failed and not raised:
                        raised = True
                        raise subprocess.TimeoutExpired('synthetic-secret', 30)

                def probe():
                    self.events.append('probe')
                    if failed == 'probe':
                        raise RuntimeError('synthetic-secret')
                    return True

                self.command.side_effect = event
                with self.assertRaisesRegex(Refused, '^Nginx install failed; original configuration restored$'):
                    self.install(probe)
                self.assertEqual(self.current, BEFORE)
                self.assertEqual(self.events[-3:], ['restore', 'syntax', 'reload'])

    def test_postprobe_must_be_callable_and_return_exact_true(self):
        self.mocks()
        with self.assertRaises(Refused):
            self.install(None)
        self.assertEqual(self.events, [])
        for result in (False, None, 1, {'ready': True}):
            self.installer = installation.PublicNginxInstaller(Path('/root/synthetic-audit'))
            with self.subTest(result=result), self.assertRaises(Refused):
                self.install(lambda: result)
            self.assertEqual(self.current, BEFORE)

    def test_rollback_never_overwrites_an_independent_change(self):
        self.mocks()

        def probe():
            self.current = b'operator change'
            return False

        with self.assertRaisesRegex(Refused, 'operator attention'):
            self.install(probe)
        self.assertEqual(self.current, b'operator change')
        self.assertNotIn('restore', self.events)

    def test_owner_can_rollback_after_later_combined_step_fails(self):
        self.mocks()
        self.install(self.probe)
        self.installer.rollback()
        self.assertEqual(self.current, BEFORE)
        self.assertEqual(self.events[-3:], ['restore', 'syntax', 'reload'])
        self.installer.rollback()
        self.assertEqual(self.events.count('restore'), 1)

    def test_deadline_nonroot_and_unpinned_content_refuse_before_writes(self):
        self.mocks()
        for target, key, value in ((installation.os, 'getuid', 1), (installation.os, 'geteuid', 1),
                                   (installation.time, 'time', DEADLINE_EPOCH)):
            with patch.object(target, key, return_value=value), self.assertRaises(Refused):
                self.install(self.probe)
        self.current += b'# changed'
        with self.assertRaises(Refused):
            self.install(self.probe)
        self.assertEqual(self.events, [])

    def test_deadline_expiring_during_postprobe_rolls_back(self):
        self.mocks()
        with patch.object(installation.time, 'time', return_value=DEADLINE_EPOCH - 1) as clock:
            def probe():
                clock.return_value = DEADLINE_EPOCH
                return True

            with self.assertRaises(Refused):
                self.install(probe)
        self.assertEqual(self.current, BEFORE)

    def test_existing_backup_or_target_change_during_backup_never_mutates_target(self):
        self.mocks()
        self.backup.side_effect = Refused('Existing private output retained')
        with self.assertRaises(Refused):
            self.install(self.probe)
        self.write.assert_not_called()
        self.backup.side_effect = lambda *_: setattr(self, 'current', b'operator change')
        with self.assertRaises(Refused):
            self.install(self.probe)
        self.write.assert_not_called()

    def test_repeat_install_refuses_without_reloading(self):
        self.mocks()
        self.install(self.probe)
        previous = list(self.events)
        with self.assertRaises(Refused):
            self.install(self.probe)
        self.assertEqual(self.events, previous)

    def test_failed_rollback_reports_only_redacted_operator_attention(self):
        self.mocks()
        self.command.side_effect = RuntimeError('synthetic-secret')
        with self.assertRaisesRegex(Refused, '^Nginx install failed; rollback requires operator attention$'):
            self.install(self.probe)

    def test_commands_are_bounded_silent_and_use_no_inherited_environment(self):
        with patch.object(installation.subprocess, 'run') as run:
            installation._command(['/usr/sbin/nginx', '-t'])
        arguments = run.call_args.kwargs
        self.assertEqual(arguments['timeout'], 30)
        self.assertTrue(arguments['check'])
        for stream in ('stdin', 'stdout', 'stderr'):
            self.assertEqual(arguments[stream], subprocess.DEVNULL)
        self.assertEqual(arguments['env']['PATH'], '/usr/sbin:/usr/bin:/sbin:/bin')
        self.assertNotIn('shell', arguments)

    def test_atomic_write_under_umask077_preserves_mode_and_never_truncates_target(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'config'
            target.write_bytes(BEFORE)
            target.chmod(0o400)
            metadata = target.stat()
            prior_umask = os.umask(0o077)
            try:
                with patch.object(installation, 'TARGET', target), patch.object(installation.os, 'fchown'), \
                        patch.object(installation, '_read_target', side_effect=lambda: (target.read_bytes(), target.stat())):
                    installation._atomic_write(AFTER, metadata, BEFORE, metadata)
                self.assertEqual(target.read_bytes(), AFTER)
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o400)
                self.assertEqual(target.stat().st_mtime_ns, metadata.st_mtime_ns)
                self.assertEqual(list(Path(directory).iterdir()), [target])
            finally:
                os.umask(prior_umask)

    def test_atomic_replace_failure_preserves_target_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'config'
            target.write_bytes(BEFORE)
            with patch.object(installation, 'TARGET', target), patch.object(installation.os, 'fchown'), \
                    patch.object(installation.os, 'replace', side_effect=OSError('synthetic failure')), \
                    patch.object(installation, '_read_target', side_effect=lambda: (target.read_bytes(), target.stat())):
                with self.assertRaises(OSError):
                    installation._atomic_write(AFTER, target.stat(), BEFORE, target.stat())
            self.assertEqual(target.read_bytes(), BEFORE)
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_read_requires_sealed_target_and_exact_root_owned_enabled_symlink(self):
        link = Mock(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0, st_nlink=1)
        with patch.object(installation, 'root_ancestors'), \
                patch.object(installation.Path, 'lstat', side_effect=lambda path=None: self.metadata), \
                patch.object(installation, 'read_file', return_value=BEFORE) as read, \
                patch.object(installation.os, 'readlink', return_value=str(installation.TARGET)):
            with patch.object(installation.Path, 'lstat', side_effect=[link, self.metadata, self.metadata, link]):
                self.assertEqual(installation._read_target(), (BEFORE, self.metadata))
            read.assert_called_once_with(installation.TARGET, 0, 0o400, installation.LIMIT + 16384)
            for change in ({'st_uid': 501}, {'st_gid': 501}, {'st_nlink': 2}, {'st_mode': stat.S_IFREG | 0o400}):
                unsafe = Mock(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0, st_nlink=1)
                unsafe.configure_mock(**change)
                with patch.object(installation.Path, 'lstat', return_value=unsafe), self.assertRaises(Refused):
                    installation._read_target()
            with patch.object(installation.Path, 'lstat', return_value=link), \
                    patch.object(installation.os, 'readlink', return_value='/etc/nginx/other'), self.assertRaises(Refused):
                installation._read_target()

    def test_unchanged_refuses_inode_replacement_even_with_identical_bytes(self):
        self.mocks()
        with patch.object(installation, '_read_target', return_value=(BEFORE, Mock(st_ino=999))):
            with self.assertRaises(Refused):
                installation._unchanged(BEFORE, self.metadata)

    def test_interrupt_during_probe_rolls_back_without_leaking_diagnostic(self):
        self.mocks()
        with self.assertRaisesRegex(Refused, 'original configuration restored'):
            self.install(Mock(side_effect=KeyboardInterrupt('synthetic-secret')))
        self.assertEqual(self.current, BEFORE)

    def test_preflight_cannot_repin_a_changed_file_and_preserves_whole_baseline(self):
        self.mocks()
        self.assertEqual(self.installer.preflight(), PIN)
        self.assertEqual(self.installer.original, BEFORE)
        self.current += b'# changed'
        with self.assertRaises(Refused):
            self.installer.preflight()
        with self.assertRaises(Refused):
            self.installer.install(PIN, self.probe, baselineprobe=self.baseline)
        self.assertEqual(self.events, [])

    def test_baseline_failure_prevents_writes_or_rolls_back_and_reprobes_original(self):
        self.mocks()
        self.baseline.return_value = False
        with self.assertRaisesRegex(Refused, 'no configuration written'):
            self.install(self.probe)
        self.assertEqual(self.events, [])
        self.baseline.side_effect = [True, False, True]
        with self.assertRaisesRegex(Refused, 'original configuration restored'):
            self.install(self.probe)
        self.assertEqual(self.current, BEFORE)
        self.assertEqual(self.events[-3:], ['restore', 'syntax', 'reload'])

    def test_preflight_requires_owner_observed_size_before_capturing_pin(self):
        self.mocks()
        with patch.object(installation, 'PREDECESSOR_SIZE', 9469), self.assertRaises(Refused):
            self.installer.preflight()
        self.assertIsNone(self.installer.predecessor_sha256)
        self.assertEqual(self.events, [])


if __name__ == '__main__':
    unittest.main()
