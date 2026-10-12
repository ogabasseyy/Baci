import ast
import hashlib
import importlib.util
import inspect
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
        spec = importlib.util.spec_from_file_location('start_seal_test', HERE / 'replay_start_seal.py')
        self.subject = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.subject)
        self.directory = Path('/root/baci-probe-sealed.fixture/owner')

    def manifest(self):
        return dict(kind='guarded-replay-start', files={name: 'a' * 64 for name in self.subject.SOURCE_FILES},
            fenceInventorySha256=self.subject.FENCE_PIN, reviewed=dict(self.subject.REVIEWED))

    def metadata(self, **overrides):
        values = dict(st_mode=0o100600, st_uid=0, st_gid=0, st_nlink=1,
            st_dev=1, st_ino=2, st_size=7, st_mtime_ns=3, st_ctime_ns=4)
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_exact_manifest_captures_cjs_and_topological_probe_dependencies(self):
        self.subject.validate_manifest(self.manifest())
        self.assertIn('claim_probe.cjs', self.subject.SOURCE_FILES)
        self.assertNotIn('claim_probe', self.subject.MODULES)
        self.assertEqual(self.subject.MODULES[-3:],
            ('replay_start_inventory', 'replay_start_readiness', 'replay_start_owner'))

    def test_manifest_rejects_missing_extra_or_unpinned_source_and_review_drift(self):
        for change in ('kind', 'missing-cjs', 'missing-owner', 'old-seal', 'bad-pin', 'review', 'extra-review', 'fence'):
            manifest = self.manifest()
            if change == 'kind':
                manifest['kind'] = 'commit-only-replay-fence'
            elif change == 'missing-cjs':
                manifest['files'].pop('claim_probe.cjs')
            elif change == 'missing-owner':
                manifest['files'].pop('replay_start_owner.py')
            elif change == 'old-seal':
                manifest['files']['replay_fence_commit_seal.py'] = 'a' * 64
            elif change == 'bad-pin':
                manifest['files']['claim_probe.cjs'] = 'invalid'
            elif change == 'review':
                manifest['reviewed']['committedAuditSha256'] = 'b' * 64
            elif change == 'extra-review':
                manifest['reviewed']['probe'] = True
            else:
                manifest['fenceInventorySha256'] = 'b' * 64
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.subject.validate_manifest(manifest)

    def test_duplicate_json_keys_and_nonfinite_values_refuse(self):
        for raw in (b'{"files":{},"files":{}}', b'{"value":NaN}', b'{"value":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.subject.decode(raw)

    def test_capture_authenticates_cjs_and_closes_both_source_directories(self):
        manifest = self.manifest()
        raw = self.subject.encoded(manifest)
        digest = hashlib.sha256(raw).hexdigest()
        rows = b'a' * 64 + b'  renderer.py\n' + b'b' * 64 + b'  contract.py\n'
        def read(path, expected):
            if path.name == 'release.json':
                self.assertEqual(expected, digest)
                return raw
            if path.name == 'SOURCE-INVENTORY.sha256':
                self.assertEqual(expected, self.subject.FENCE_PIN)
                return rows
            return path.name.encode()
        with patch.object(self.subject, 'protected', side_effect=read), patch.object(self.subject, 'exact_directory') as exact:
            observed, captured, fenced = self.subject.capture(self.directory, digest)
        self.assertEqual(observed, manifest)
        self.assertEqual(captured['claim_probe.cjs'], b'claim_probe.cjs')
        exact.assert_any_call(self.directory, self.subject.SOURCE_FILES | {'release.json', 'replay_start_seal.py'})
        exact.assert_any_call(self.directory.parent / 'replay-claim-fence', set(fenced) | {'SOURCE-INVENTORY.sha256'})

    def test_wrong_release_hash_refuses_before_loading(self):
        with patch.object(self.subject, 'protected', return_value=self.subject.encoded(self.manifest())), self.assertRaises(ValueError):
            self.subject.capture(self.directory, 'b' * 64)

    def test_old_bootstraps_bytecode_cache_and_unsafe_directory_metadata_refuse(self):
        directory = Mock()
        names = self.subject.SOURCE_FILES | {'release.json', 'replay_start_seal.py'}
        directory.lstat.return_value = self.metadata(st_mode=0o40700)
        for extra in ('replay_fence_commit_seal.py', 'replay_rehearsal_seal.py', '__pycache__'):
            directory.iterdir.return_value = [SimpleNamespace(name=name) for name in names | {extra}]
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.subject.exact_directory(directory, names)
        directory.iterdir.return_value = [SimpleNamespace(name=name) for name in names]
        self.subject.exact_directory(directory, names)
        directory.lstat.return_value = self.metadata(st_mode=0o40755)
        with self.assertRaises(ValueError):
            self.subject.exact_directory(directory, names)

    def test_loader_executes_only_authenticated_python_and_never_cjs(self):
        sources = {name + '.py': b'marker = "captured"' for name in self.subject.MODULES}
        sources['claim_probe.cjs'] = b'not Python; never execute this script!'
        sources['replay_start_owner.py'] = b'import probe_transport\nmarker = probe_transport.marker'
        with patch.dict(sys.modules), patch.object(Path, 'read_bytes', side_effect=AssertionError('disk import')):
            for name in self.subject.MODULES:
                sys.modules.pop(name, None)
            modules = self.subject.load_modules(self.directory, sources)
            self.assertEqual(modules['replay_start_owner'].marker, 'captured')
            self.assertEqual(list(modules), list(self.subject.MODULES))
            self.assertNotIn('claim_probe', modules)

    def test_unsealed_module_is_never_overwritten(self):
        existing = object()
        with patch.dict(sys.modules, {'cutover_context': existing}):
            with self.assertRaises(ValueError):
                self.subject.load_modules(self.directory, {})
            self.assertIs(sys.modules['cutover_context'], existing)

    def test_protected_file_hash_identity_and_parent_permissions_are_checked(self):
        raw = b'fixture'
        digest = hashlib.sha256(raw).hexdigest()
        info, parent = self.metadata(), self.metadata(st_mode=0o40700)
        handle = Mock()
        handle.__enter__ = Mock(return_value=handle)
        handle.__exit__ = Mock(return_value=False)
        handle.read.return_value = raw
        handle.fileno.return_value = 77
        def metadata(path):
            return info if path.name == 'fixture' else parent
        with patch.object(Path, 'lstat', metadata), patch.object(self.subject.os, 'open', return_value=77), \
                patch.object(self.subject.os, 'fdopen', return_value=handle), patch.object(self.subject.os, 'fstat', return_value=info):
            self.assertEqual(self.subject.protected('/root/fixture', digest), raw)
            with self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', 'a' * 64)
            with patch.object(self.subject.os, 'fstat', return_value=self.metadata(st_ino=3)), self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', digest)
            info.st_nlink = 2
            with self.assertRaises(ValueError):
                self.subject.protected('/root/fixture', digest)

    def invoke_main(self, mode, *, result=None, callback=None):
        manifest, captured = self.manifest(), {name: b'authenticated' for name in self.subject.SOURCE_FILES}
        modules = {name: ModuleType(name) for name in self.subject.MODULES}
        for name, module in modules.items():
            module.__file__ = str(self.directory / (name + '.py'))
        output = io.StringIO()
        def invoke(directory, reviewed, verify, read, *, start):
            self.assertEqual(directory, self.directory)
            self.assertEqual(reviewed, self.subject.REVIEWED)
            self.assertIs(read, self.subject.protected)
            self.assertIs(start, mode == '--start')
            self.assertTrue(verify())
            if callback:
                callback(modules, captured, verify)
            return result if result is not None else dict(status=self.subject.SUCCESSES[start], liveReplayStarted=start, launchAuthorized=start,
                financialActionAttempted=False, newPaymentStarted=False, transactionAttempted=False)
        modules['replay_start_owner'].invoke = invoke
        modules['replay_start_owner'].REVIEWED = dict(self.subject.REVIEWED)
        owner_read = lambda path, digest: b'authenticated-retained-audit'
        flags = SimpleNamespace(isolated=True, no_site=True, dont_write_bytecode=True, optimize=False)
        with patch.object(self.subject, '__file__', str(self.directory / 'replay_start_seal.py')), \
                patch.object(self.subject.os, 'geteuid', return_value=0), patch.object(sys, 'flags', flags), \
                patch.object(Path, 'lstat', return_value=self.metadata(st_mode=0o40700)), \
                patch.object(self.subject, 'capture', side_effect=lambda *args: (manifest, dict(captured), {})), \
                patch.object(self.subject, 'load_modules', return_value=modules), \
                patch.object(self.subject, 'protected', owner_read), \
                patch.object(self.subject, 'validate_focused'), \
                patch.dict(sys.modules, modules), patch.object(sys, 'stdout', output):
            code = self.subject.main(['a' * 64, mode])
        return code, json.loads(output.getvalue())

    def test_check_and_probe_route_exact_signature_without_financial_or_launch_authority(self):
        for mode in ('--check', '--start'):
            code, result = self.invoke_main(mode)
            self.assertEqual(code, 0)
            self.assertEqual(result['status'], self.subject.SUCCESSES[mode == '--start'])
            self.assertIs(result['liveReplayStarted'], mode == '--start')
            self.assertFalse(result['financialActionAttempted'])

    def test_changed_cjs_bytes_and_module_origin_refuse_revalidation(self):
        def cjs_drift(modules, captured, verify):
            captured['claim_probe.cjs'] = b'replaced'
            verify()
        def origin_drift(modules, captured, verify):
            modules['probe_transport'].__file__ = '/unsealed/transport.py'
            verify()
        for callback in (cjs_drift, origin_drift):
            code, result = self.invoke_main('--start', callback=callback)
            self.assertEqual(code, 1)
            self.assertTrue(result['redacted'])

    def test_private_result_and_exception_text_never_enter_public_output(self):
        code, result = self.invoke_main('--start', result=dict(status=self.subject.SUCCESSES[1],
            liveReplayStarted=True, launchAuthorized=True, financialActionAttempted=False,
            newPaymentStarted=False, transactionAttempted=False, protectedSnapshots={'token': 'private-secret'}, diagnostic={'message': 'private-secret'}, auditSha256='a' * 64))
        self.assertEqual(code, 0)
        self.assertNotIn('private-secret', json.dumps(result))
        def failed(modules, captured, verify):
            raise RuntimeError('private-secret')
        code, result = self.invoke_main('--start', callback=failed)
        self.assertEqual(code, 1)
        self.assertNotIn('private-secret', json.dumps(result))
        self.assertEqual(set(result['diagnostic']), {'type', 'module', 'line'})

    def test_refusal_wrong_phase_status_and_unsafe_flags_fail_closed(self):
        for result in (dict(status='replay-start-refused'), dict(status=self.subject.SUCCESSES[0]),
                dict(status=self.subject.SUCCESSES[1], launchAuthorized=True), dict(status='private-secret')):
            code, public = self.invoke_main('--start', result=result)
            self.assertEqual(code, 1)
            self.assertNotIn('private-secret', json.dumps(public))

    def test_modes_root_and_isolation_are_checked_before_loading(self):
        with patch.object(self.subject, 'capture') as capture, patch.object(sys, 'stdout', io.StringIO()):
            for args in (['a' * 64, '--commit'], ['a' * 64, '--rehearse'], ['invalid', '--start'], ['a' * 64, '--check']):
                self.assertEqual(self.subject.main(args), 1)
        capture.assert_not_called()

    def test_retained_probe_and_commit_bytes_are_revalidated_under_owner_guard(self):
        def changed_audit(modules, captured, verify):
            with patch.object(self.subject, 'protected', return_value=b'changed-retained-audit'):
                verify()
        code, result = self.invoke_main('--start', callback=changed_audit)
        self.assertEqual(code, 1)
        self.assertIsNone(result['liveReplayStarted'])
        self.assertFalse(result['startupStateVerified'])

    def test_start_exception_never_fabricates_a_stopped_runtime(self):
        def failed(modules, captured, verify):
            raise OSError('private-runtime-state')
        code, result = self.invoke_main('--start', callback=failed)
        self.assertEqual(code, 1)
        self.assertIsNone(result['liveReplayStarted'])
        self.assertNotIn('private-runtime-state', json.dumps(result))

    def test_start_success_requires_explicit_start_mode_and_no_financial_actions(self):
        result = dict(status=self.subject.SUCCESSES[1], liveReplayStarted=True,
            launchAuthorized=True, transactionAttempted=False, newPaymentStarted=False,
            financialActionAttempted=False)
        with self.assertRaises(ValueError):
            self.subject.public_summary(result, start=False)
        for field in ('transactionAttempted', 'newPaymentStarted', 'financialActionAttempted'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.subject.public_summary(dict(result, **{field: True}), start=True)
        self.assertTrue(self.subject.public_summary(result, start=True)['liveReplayStarted'])

    def test_existing_real_dependencies_load_without_runtime_actions(self):
        sources = {name: (HERE / name).read_bytes() for name in self.subject.SOURCE_FILES}
        with patch.dict(sys.modules):
            for name in self.subject.MODULES:
                sys.modules.pop(name, None)
            modules = self.subject.load_modules(self.directory, sources)
            self.assertIs(modules['replay_start_owner'].probe_owner,
                modules['replay_generation_probe_owner'])
            self.assertEqual({key: self.subject.REVIEWED[key]
                for key in modules['replay_generation_probe_owner'].REVIEWED},
                modules['replay_generation_probe_owner'].REVIEWED)
            owner = modules['replay_start_owner']
            self.assertTrue(all(self.subject.REVIEWED[key] == value for key, value in owner.REVIEWED.items()))
            locks = Mock()
            locks.held.return_value = True
            manager = Mock()
            manager.__enter__ = Mock(return_value=locks)
            manager.__exit__ = Mock(return_value=False)
            retained = {}
            for start in (False, True):
                result = dict(status=self.subject.SUCCESSES[start], checkPassed=True, liveReplayStarted=start,
                    launchAuthorized=start, startAttempted=start, readinessPassed=True, prestartPassed=start,
                    focusedRunnerPassed=start, candidateStopConfirmed=not start,
                    transactionAttempted=False, financialActionAttempted=False, newPaymentStarted=False,
                    predecessorRestarted=False, receiptCreditProved=False)
                with patch.object(owner, 'HeldLocks', return_value=manager), patch.object(owner, 'Callbacks'), \
                        patch.object(owner, 'operate', return_value=result), \
                        patch.object(owner, 'persist', side_effect=lambda path, raw: retained.update({path: raw})):
                    actual = owner.invoke(self.directory, self.subject.REVIEWED, lambda: True,
                        lambda path, digest: retained[path], start=start)
                self.assertEqual(self.subject.public_summary(actual, start=start)['status'], result['status'])

    def test_focused_runner_optional_input_requires_exact_private_path_and_pin(self):
        manifest = self.manifest()
        manifest['reviewed']['focusedRunner'] = dict(self.subject.FOCUSED)
        self.subject.validate_manifest(manifest)
        for path in ('/tmp/runner.json', '/root/../tmp/runner.json'):
            manifest['reviewed']['focusedRunner']['path'] = path
            with self.assertRaises(ValueError):
                self.subject.validate_manifest(manifest)



if __name__ == '__main__':
    unittest.main()
