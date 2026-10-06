import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent


class Tests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('commit_seal_test', HERE / 'replay_fence_commit_seal.py')
        self.subject = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.subject)
        self.directory = Path('/root/baci-commit-sealed.fixture/owner')

    def manifest(self):
        return dict(kind='commit-only-replay-fence',
            files={name + '.py': 'a' * 64 for name in self.subject.MODULES},
            fenceInventorySha256=self.subject.FENCE_PIN, reviewed=dict(self.subject.REVIEWED))

    def metadata(self, **overrides):
        values = dict(st_mode=0o100600, st_uid=0, st_gid=0, st_nlink=1,
            st_dev=1, st_ino=2, st_size=7, st_mtime_ns=3, st_ctime_ns=4)
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_exact_commit_manifest_and_dependency_order(self):
        self.subject.validate_manifest(self.manifest())
        self.assertEqual(self.subject.MODULES[-2:], ('replay_rehearsal_owner', 'replay_fence_commit_owner'))
        old_spec = importlib.util.spec_from_file_location('old_seal_contract', HERE / 'replay_rehearsal_seal.py')
        old = importlib.util.module_from_spec(old_spec)
        old_spec.loader.exec_module(old)
        self.assertEqual(self.subject.MODULES[:-1], old.MODULES)
        self.assertEqual(self.subject.REVIEWED, old.REVIEWED)

    def test_manifest_rejects_wrong_kind_review_scope_source_set_and_pins(self):
        for change in ('kind', 'audit', 'review-extra', 'missing', 'extra', 'pin', 'fence', 'top-extra'):
            manifest = self.manifest()
            if change == 'kind':
                manifest['kind'] = 'rollback-only-replay-rehearsal'
            elif change == 'audit':
                manifest['reviewed']['financialAuditSha256'] = 'b' * 64
            elif change == 'review-extra':
                manifest['reviewed']['mode'] = 'commit'
            elif change == 'missing':
                manifest['files'].pop('replay_fence_commit_owner.py')
            elif change == 'extra':
                manifest['files']['replay_rehearsal_seal.py'] = 'a' * 64
            elif change == 'pin':
                manifest['files']['cutover_runtime.py'] = 'invalid'
            elif change == 'fence':
                manifest['fenceInventorySha256'] = 'b' * 64
            else:
                manifest['injected'] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.subject.validate_manifest(manifest)

    def test_json_duplicate_keys_and_nonfinite_values_refuse(self):
        for raw in (b'{"files":{},"files":{}}', b'{"value":NaN}', b'{"value":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.subject.decode(raw)

    def test_exact_directory_rejects_old_bootstrap_extra_cache_and_unsafe_metadata(self):
        directory = Mock()
        names = {'release.json', 'replay_fence_commit_seal.py'}
        directory.lstat.return_value = self.metadata(st_mode=0o40700)
        for extra in ('replay_rehearsal_seal.py', '__pycache__'):
            directory.iterdir.return_value = [SimpleNamespace(name=name) for name in names | {extra}]
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.subject.exact_directory(directory, names)
        directory.iterdir.return_value = [SimpleNamespace(name=name) for name in names]
        self.subject.exact_directory(directory, names)
        directory.lstat.return_value = self.metadata(st_mode=0o40755)
        with self.assertRaises(ValueError):
            self.subject.exact_directory(directory, names)

    def test_capture_closes_owner_and_fence_sources_using_protected_bytes(self):
        manifest = self.manifest()
        raw = self.subject.encoded(manifest)
        digest = hashlib.sha256(raw).hexdigest()
        fence = self.directory.parent / 'replay-claim-fence'
        rows = b'a' * 64 + b'  renderer.py\n' + b'b' * 64 + b'  contract.py\n'
        def read(path, expected):
            if path.name == 'release.json':
                self.assertEqual(expected, digest)
                return raw
            if path.name == 'SOURCE-INVENTORY.sha256':
                self.assertEqual(expected, self.subject.FENCE_PIN)
                return rows
            return path.name.encode()
        with patch.object(self.subject, 'protected', side_effect=read), \
                patch.object(self.subject, 'exact_directory') as exact:
            observed, captured, fenced = self.subject.capture(self.directory, digest)
        self.assertEqual(observed, manifest)
        self.assertEqual(set(captured), set(manifest['files']))
        self.assertEqual(set(fenced), {'renderer.py', 'contract.py'})
        exact.assert_any_call(self.directory, set(manifest['files']) | {'release.json', 'replay_fence_commit_seal.py'})
        exact.assert_any_call(fence, {'renderer.py', 'contract.py', 'SOURCE-INVENTORY.sha256'})

    def test_wrong_manifest_hash_refuses_before_source_load(self):
        with patch.object(self.subject, 'protected', return_value=self.subject.encoded(self.manifest())), \
                patch.object(self.subject, 'load_modules') as load, self.assertRaises(ValueError):
            self.subject.capture(self.directory, 'b' * 64)
        load.assert_not_called()

    def test_captured_modules_load_without_disk_import_and_in_dependency_order(self):
        sources = {name + '.py': b'marker = "captured"' for name in self.subject.MODULES}
        sources['replay_fence_commit_owner.py'] = b'import replay_rehearsal_owner\nmarker = replay_rehearsal_owner.marker'
        with patch.dict(sys.modules), patch.object(Path, 'read_bytes', side_effect=AssertionError('disk import')):
            for name in self.subject.MODULES:
                sys.modules.pop(name, None)
            modules = self.subject.load_modules(self.directory, sources)
            self.assertEqual(modules['replay_fence_commit_owner'].marker, 'captured')
            self.assertEqual(list(modules), list(self.subject.MODULES))
            for name, module in modules.items():
                self.assertIs(sys.modules[name], module)
                self.assertEqual(module.__file__, str(self.directory / (name + '.py')))

    def test_unsealed_module_is_not_overwritten(self):
        existing = object()
        with patch.dict(sys.modules, {'cutover_runtime': existing}):
            with self.assertRaises(ValueError):
                self.subject.load_modules(self.directory, {})
            self.assertIs(sys.modules['cutover_runtime'], existing)

    def test_protected_read_requires_root_private_unchanged_hashed_file(self):
        raw = b'fixture'
        digest = hashlib.sha256(raw).hexdigest()
        info = self.metadata()
        parent = self.metadata(st_mode=0o40700)
        handle = Mock()
        handle.__enter__ = Mock(return_value=handle)
        handle.__exit__ = Mock(return_value=False)
        handle.read.return_value = raw
        handle.fileno.return_value = 77
        def metadata(path):
            return info if path.name == 'fixture' else parent
        with patch.object(Path, 'lstat', metadata), patch.object(self.subject.os, 'open', return_value=77), \
                patch.object(self.subject.os, 'fdopen', return_value=handle), \
                patch.object(self.subject.os, 'fstat', return_value=info):
            self.assertEqual(self.subject.protected('/root/fixture', digest), raw)
            with self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', 'a' * 64)
            with patch.object(self.subject.os, 'fstat', return_value=self.metadata(st_ino=3)), self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', digest)
            info.st_nlink = 2
            with self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', digest)

    def test_protected_read_rejects_path_symlink_parent_writable_and_hash_drift(self):
        for path in ('relative', '/root/../fixture'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.subject.protected(path, 'a' * 64)
        for mode in (0o120600, 0o100644):
            with patch.object(Path, 'lstat', return_value=self.metadata(st_mode=mode)), self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', 'a' * 64)
        with patch.object(Path, 'lstat', return_value=self.metadata(st_mode=0o40777)), self.assertRaises(ValueError):
            self.subject.protected('/root/fixture', 'a' * 64)

    def invoke_main(self, mode, *, result=None, callback=None, actual=False):
        manifest = self.manifest()
        modules = {name: ModuleType(name) for name in self.subject.MODULES}
        for name, module in modules.items():
            module.__file__ = str(self.directory / (name + '.py'))
        expected = self.subject.SUCCESSES[mode == '--commit']
        captured = {name + '.py': b'authenticated' for name in modules}
        output = io.StringIO()
        def invoke(directory, reviewed, verify, read, *, commit):
            self.assertEqual(directory, self.directory)
            self.assertEqual(reviewed, self.subject.REVIEWED)
            self.assertIs(read, self.subject.protected)
            self.assertIs(commit, mode == '--commit')
            self.assertTrue(verify())
            if callback:
                callback(modules, verify)
            return result if result is not None else dict(status=expected)
        modules['replay_fence_commit_owner'].invoke = invoke
        if actual:
            sources = {name + '.py': (HERE / (name + '.py')).read_bytes() for name in self.subject.MODULES}
            with patch.dict(sys.modules):
                for name in self.subject.MODULES:
                    sys.modules.pop(name, None)
                modules = self.subject.load_modules(self.directory, sources)
            captured = sources
            owner = modules['replay_fence_commit_owner']
            locks = Mock()
            locks.held.return_value = True
            context = Mock()
            context.__enter__ = Mock(return_value=locks)
            context.__exit__ = Mock(return_value=False)
            owner.HeldLocks = lambda: context
            owner.Callbacks = Mock()
            review = dict(original='fixture', proof={}, receipt={}, auditRaw=b'{"result":{"rehearsal":{"before":{}}}}')
            owner.authenticate_review = lambda callbacks: review
            owner.capture = lambda callbacks, reviewed: {}
            owner.rehearsal._same_application = lambda before, after: None
            owner.database.capture_snapshot = lambda query: {}
            owner.database._state = lambda snapshot: {}
            transport = SimpleNamespace(reserved=False, attempted=False, acknowledged=False, execute=Mock())
            owner.CommitTransport = lambda *args: transport
            def run_fence(*args, **kwargs):
                transport.acknowledged = True
                return dict(status='fence_committed_keep_stopped', receipt={}, receiptSha256=owner.sha(owner.encoded({})))
            owner.database.run_fence = run_fence
            retained = {}
            owner.persist = lambda path, raw: retained.update({path: raw})
            owner_read = lambda path, digest: retained[path]
        else:
            owner_read = self.subject.protected
        flags = SimpleNamespace(isolated=True, no_site=True, dont_write_bytecode=True, optimize=False)
        with patch.object(self.subject, '__file__', str(self.directory / 'replay_fence_commit_seal.py')), \
                patch.object(self.subject.os, 'geteuid', return_value=0), patch.object(sys, 'flags', flags), \
                patch.object(Path, 'lstat', return_value=self.metadata(st_mode=0o40700)), \
                patch.object(self.subject, 'capture', return_value=(manifest, captured, {})), \
                patch.object(self.subject, 'load_modules', return_value=modules), \
                patch.object(self.subject, 'protected', owner_read), \
                patch.dict(sys.modules, modules), patch.object(sys, 'stdout', output):
            code = self.subject.main(['a' * 64, mode])
        return code, json.loads(output.getvalue())

    def test_check_and_commit_dispatch_exact_owner_signature_and_status(self):
        for mode in ('--check', '--commit'):
            code, result = self.invoke_main(mode)
            self.assertEqual(code, 0)
            self.assertEqual(result['status'], self.subject.SUCCESSES[mode == '--commit'])
            self.assertFalse(result['liveReplayStarted'])

    def test_public_errors_and_extra_protected_results_are_redacted(self):
        def failed(modules, verify):
            raise RuntimeError('private-secret')
        code, result = self.invoke_main('--commit', callback=failed)
        self.assertEqual(code, 1)
        self.assertTrue(result['redacted'])
        self.assertNotIn('private-secret', json.dumps(result))
        self.assertEqual(result['diagnostic']['type'], 'RuntimeError')
        self.assertEqual(set(result['diagnostic']), {'type', 'module', 'line'})
        code, result = self.invoke_main('--commit', result=dict(status=self.subject.SUCCESSES[1],
            protectedSnapshot={'token': 'private-secret'}, commitAcknowledged=True, auditSha256='a' * 64))
        self.assertEqual(code, 0)
        self.assertNotIn('private-secret', json.dumps(result))
        self.assertTrue(result['commitAcknowledged'])

    def test_loaded_module_registry_or_origin_drift_refuses(self):
        def drift(modules, verify):
            modules['replay_fence_commit_owner'].__file__ = '/unsealed/owner.py'
            verify()
        code, result = self.invoke_main('--commit', callback=drift)
        self.assertEqual(code, 1)
        self.assertTrue(result['redacted'])

    def test_actual_commit_owner_invocation_routing_and_public_status_contract(self):
        for mode in ('--check', '--commit'):
            code, result = self.invoke_main(mode, actual=True)
            self.assertEqual(code, 0, result)
            self.assertEqual(result['status'], self.subject.SUCCESSES[mode == '--commit'])

    def test_wrong_mode_success_status_and_owner_refusal_exit_nonzero(self):
        for status in (self.subject.SUCCESSES[0], 'replay-fence-commit-refused', 'private-secret'):
            code, result = self.invoke_main('--commit', result=dict(status=status))
            self.assertEqual(code, 1)
            self.assertNotIn('private-secret', json.dumps(result))
        code, result = self.invoke_main('--commit', result=dict(status=self.subject.SUCCESSES[1], liveReplayStarted=True))
        self.assertEqual(code, 1)
        self.assertTrue(result['redacted'])

    def test_root_isolation_modes_and_optimization_required_before_capture(self):
        output = io.StringIO()
        with patch.object(self.subject, 'capture') as capture, patch.object(sys, 'stdout', output):
            for args in (['a' * 64, '--rehearse'], ['invalid', '--commit'], ['a' * 64, '--commit']):
                self.assertEqual(self.subject.main(args), 1)
        capture.assert_not_called()


if __name__ == '__main__':
    unittest.main()
