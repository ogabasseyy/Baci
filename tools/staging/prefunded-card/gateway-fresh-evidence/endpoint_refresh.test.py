import unittest
import hashlib
import os
from pathlib import Path
import tempfile
import sys
import stat
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from endpoint_refresh import SOURCES, authenticate, load_runtime, recovery, run_transition

class Tests(unittest.TestCase):
    def actions(self):
        actions = Mock()
        actions.collect.return_value = {'binding': b'new-binding', 'evidence': b'new-evidence'}
        return actions

    def test_preflight_never_writes_or_starts(self):
        actions = self.actions()
        self.assertFalse(run_transition(actions)['applied'])
        actions.backup.assert_not_called()
        actions.replace.assert_not_called()
        actions.start.assert_not_called()

    def test_both_files_validated_before_start(self):
        actions = self.actions()
        self.assertTrue(run_transition(actions, True)['applied'])
        names = [entry[0] for entry in actions.mock_calls]
        self.assertLess(names.index('backup'), names.index('replace'))
        self.assertLess(names.index('validate_installed'), names.index('start'))

    def test_second_replace_failure_restores_and_never_starts(self):
        actions = self.actions()
        actions.replace.side_effect = ValueError('private failure')
        with self.assertRaisesRegex(ValueError, '^endpoint_refresh_refused$'):
            run_transition(actions, True)
        actions.restore.assert_called_once()
        actions.start.assert_not_called()
        actions.stop.assert_not_called()

    def test_failed_verification_stops_owned_gateway_before_restore(self):
        actions = self.actions()
        actions.verify.side_effect = RuntimeError('secret')
        with self.assertRaisesRegex(ValueError, '^endpoint_refresh_refused$'):
            run_transition(actions, True)
        names = [entry[0] for entry in actions.mock_calls]
        self.assertLess(names.index('stop'), names.index('restore'))
        self.assertEqual(actions.start.call_count, 1)

    def test_rollback_drift_requires_operator(self):
        actions = self.actions()
        actions.replace.side_effect = ValueError()
        actions.restore.side_effect = ValueError('foreign bytes')
        with self.assertRaisesRegex(ValueError, 'operator_required'):
            run_transition(actions, True)

    def filesystem(self, directory):
        import owner
        binding, evidence = [Path(directory) / name for name in ('binding', 'evidence')]
        binding.write_bytes(b'{"identity":{}}')
        evidence.write_bytes(b'original-evidence')
        files = Mock()

        def read(path, modes, groups, expected=None):
            content = path.read_bytes()
            if expected is not None and hashlib.sha256(content).hexdigest() != expected:
                raise ValueError('pin')
            return content, (path.stat().st_ino, path.stat().st_mtime_ns, path.stat().st_size)

        files.read.side_effect = read
        files.write.side_effect = lambda path, content: path.write_bytes(content)

        def initialize(actions, pin):
            actions.files = files
            actions.binding_bytes, fingerprint = read(binding, (), ())
            actions.binding = {'identity': {}}
            actions.preserved = {binding: (owner.digest(actions.binding_bytes), fingerprint, (0o440,), (os.getgid(),))}
            actions.old, actions.old_info = read(evidence, (), ())

        with patch('endpoint_refresh.authenticate'), patch('endpoint_refresh.load_runtime', return_value=owner), \
                patch('owner.GatewayRecovery.__init__', initialize), \
                patch('constants.BINDING', binding), patch('constants.EVIDENCE', evidence), \
                patch('constants.GROUP', os.getgid()):
            actions = recovery('a' * 64)
        actions.guard = Mock()
        actions.stopped = Mock()
        actions.backup_directory = Path(directory) / 'backups'
        actions.backup_directory.mkdir()
        for label, path in (('binding', binding), ('evidence', evidence)):
            (actions.backup_directory / (label + '.original.json')).write_bytes(path.read_bytes())
        return actions, binding, evidence

    def test_real_local_atomic_second_write_failure_restores_only_owned_first_write(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, evidence = self.filesystem(directory)
            original_binding, original_evidence = binding.read_bytes(), evidence.read_bytes()
            with patch('endpoint_refresh.os.fchown'):
                actions.target(binding, b'candidate-binding')
                with patch('endpoint_refresh.os.replace', side_effect=OSError('disk')):
                    with self.assertRaises(OSError):
                        actions.target(evidence, b'candidate-evidence')
                actions.restore({})
            self.assertEqual(binding.read_bytes(), original_binding)
            self.assertEqual(evidence.read_bytes(), original_evidence)
            self.assertFalse(list(Path(directory).glob('.endpoint-*')))

    def test_foreign_second_target_blocks_all_rollback_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, evidence = self.filesystem(directory)
            with patch('endpoint_refresh.os.fchown'):
                actions.target(binding, b'candidate-binding')
                evidence.write_bytes(b'foreign-evidence')
                with self.assertRaises(ValueError):
                    actions.restore({})
            self.assertEqual(binding.read_bytes(), b'candidate-binding')
            self.assertEqual(evidence.read_bytes(), b'foreign-evidence')

    def test_same_bytes_foreign_inode_blocks_all_rollback_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, evidence = self.filesystem(directory)
            with patch('endpoint_refresh.os.fchown'):
                actions.target(binding, b'candidate-binding')
                foreign = Path(directory) / 'foreign'
                foreign.write_bytes(evidence.read_bytes())
                os.replace(foreign, evidence)
                with self.assertRaisesRegex(ValueError, 'foreign_target'):
                    actions.restore({})
            self.assertEqual(binding.read_bytes(), b'candidate-binding')
            self.assertEqual(evidence.read_bytes(), b'original-evidence')

    def test_foreign_first_target_blocks_second_target_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, evidence = self.filesystem(directory)
            binding.write_bytes(b'foreign-binding')
            with patch('endpoint_refresh.os.fchown'):
                with self.assertRaises(ValueError):
                    actions.target(evidence, b'candidate-evidence')
            self.assertEqual(binding.read_bytes(), b'foreign-binding')
            self.assertEqual(evidence.read_bytes(), b'original-evidence')

    def test_both_owned_candidates_restore_both_originals(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, evidence = self.filesystem(directory)
            original_binding = binding.read_bytes()
            with patch('endpoint_refresh.os.fchown'):
                actions.target(binding, b'candidate-binding')
                actions.target(evidence, b'candidate-evidence')
                actions.restore({})
            self.assertEqual(binding.read_bytes(), original_binding)
            self.assertEqual(evidence.read_bytes(), b'original-evidence')
            actions.check_owned()

    def test_directory_sync_failure_after_rename_retains_owned_fingerprint_for_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, _ = self.filesystem(directory)
            original = binding.read_bytes()
            actions.files.sync.side_effect = OSError('fsync')
            with patch('endpoint_refresh.os.fchown'):
                with self.assertRaises(OSError):
                    actions.target(binding, b'candidate-binding')
                self.assertEqual(binding.read_bytes(), b'candidate-binding')
                actions.files.sync.side_effect = None
                actions.restore({})
            self.assertEqual(binding.read_bytes(), original)

    def test_preserved_guard_failure_prevents_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, _ = self.filesystem(directory)
            original = binding.read_bytes()
            actions.guard.side_effect = ValueError('preserved source drift')
            with self.assertRaises(ValueError):
                actions.target(binding, b'candidate')
            self.assertEqual(binding.read_bytes(), original)

    def test_external_authentication_failure_prevents_existing_owner_construction(self):
        with patch('endpoint_refresh.authenticate', side_effect=ValueError('manifest')), \
                patch('owner.GatewayRecovery.__init__') as initialize:
            with self.assertRaises(ValueError):
                recovery('a' * 64)
            initialize.assert_not_called()

    def test_gateway_activated_during_final_guard_prevents_rename(self):
        with tempfile.TemporaryDirectory() as directory:
            actions, binding, _ = self.filesystem(directory)
            original = binding.read_bytes()
            active = False

            def guard():
                nonlocal active
                if actions.guard.call_count == 2:
                    active = True

            def stopped():
                if active:
                    raise ValueError('active_gateway')

            actions.guard.side_effect = guard
            actions.stopped.side_effect = stopped
            with patch('endpoint_refresh.os.fchown'):
                with self.assertRaisesRegex(ValueError, 'active_gateway'):
                    actions.target(binding, b'candidate')
            self.assertEqual(binding.read_bytes(), original)

    def test_foreign_inode_or_bytes_during_final_guard_prevents_rename(self):
        for inode_only in (True, False):
            with self.subTest(inode_only=inode_only), tempfile.TemporaryDirectory() as directory:
                actions, binding, _ = self.filesystem(directory)
                foreign_content = binding.read_bytes() if inode_only else b'foreign'

                def guard():
                    if actions.guard.call_count == 2:
                        foreign = Path(directory) / 'foreign'
                        foreign.write_bytes(foreign_content)
                        os.replace(foreign, binding)

                actions.guard.side_effect = guard
                with patch('endpoint_refresh.os.fchown'):
                    with self.assertRaises(ValueError):
                        actions.target(binding, b'candidate')
                self.assertEqual(binding.read_bytes(), foreign_content)

    def test_foreign_preloaded_local_module_refuses_before_any_execution(self):
        names = ('constants', 'owner_io', 'transaction', 'owner')
        for name in names:
            with self.subTest(name=name), patch.dict(sys.modules):
                for local in names:
                    sys.modules.pop(local, None)
                sys.modules[name] = ModuleType('foreign')
                with self.assertRaisesRegex(ValueError, 'preloaded_local_runtime'):
                    load_runtime({})

    def test_loader_executes_authenticated_bytes_not_disk_or_bytecode(self):
        names = ('constants', 'owner_io', 'transaction', 'owner')
        with patch.dict(sys.modules):
            for name in names:
                sys.modules.pop(name, None)
            authenticated = {name + '.py': b'authenticated_marker = True' for name in names}
            loaded = load_runtime(authenticated)
            self.assertTrue(loaded.authenticated_marker)
            for name in names:
                self.assertEqual(sys.modules[name].__file__, str(Path(__file__).parent / (name + '.py')))

    def test_authentication_rejects_wrong_metadata_or_source_bytes(self):
        original_lstat, original_stat, original_fstat = Path.lstat, Path.stat, os.fstat
        original_path = Path
        drift, reads = None, 0

        def root_metadata(info, descriptor=False):
            nonlocal reads
            fields = list(info)
            fields[4:6] = [0, 0]
            if stat.S_ISDIR(info.st_mode):
                fields[0] = stat.S_IFDIR | 0o700
            changed = os.stat_result(fields)
            attributes = {name: getattr(changed, name) for name in
                ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size')}
            attributes.update(st_mtime_ns=info.st_mtime_ns, st_ctime_ns=info.st_ctime_ns,
                              st_atime_ns=info.st_atime_ns)
            if descriptor:
                reads += 1
                if reads % 2 == 0:
                    if drift == 'atime':
                        attributes['st_atime_ns'] += 1000000
                    elif drift == 'mtime':
                        attributes['st_mtime_ns'] += 1
            return SimpleNamespace(**attributes)

        for failure in (None, 'mode', 'bytes', 'atime', 'mtime'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                bundle = Path(directory).resolve()
                drift, reads = failure, 0
                for name in SOURCES:
                    (bundle / name).write_bytes(b'\n')
                    (bundle / name).chmod(0o600)
                manifest = ''.join(hashlib.sha256(b'\n').hexdigest() + '  ' + name + '\n' for name in SOURCES).encode()
                (bundle / 'SHA256SUMS').write_bytes(manifest)
                (bundle / 'SHA256SUMS').chmod(0o600)
                if failure == 'mode':
                    (bundle / 'owner.py').chmod(0o644)
                if failure == 'bytes':
                    (bundle / 'owner.py').write_bytes(b'foreign')
                with patch('endpoint_refresh.HERE', bundle), patch('endpoint_refresh.sys.platform', 'linux'), \
                        patch('endpoint_refresh.os.geteuid', return_value=0), \
                        patch('endpoint_refresh.Path', side_effect=lambda value: bundle.parent if value == '/root' else original_path(value)), \
                        patch.object(Path, 'lstat', lambda path: root_metadata(original_lstat(path))), \
                        patch.object(Path, 'stat', lambda path, **kwargs: root_metadata(original_stat(path, **kwargs))), \
                        patch('endpoint_refresh.os.fstat', side_effect=lambda descriptor: root_metadata(original_fstat(descriptor), True)):
                    pin = hashlib.sha256(manifest).hexdigest()
                    if failure in ('mode', 'bytes', 'mtime'):
                        with self.assertRaises(ValueError):
                            authenticate(pin)
                    else:
                        self.assertEqual(set(authenticate(pin)), set(SOURCES))


if __name__ == '__main__':
    unittest.main()
