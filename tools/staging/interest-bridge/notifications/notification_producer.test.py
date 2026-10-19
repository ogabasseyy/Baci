import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import json


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('notification_producer', HERE/'notification_producer.py')
SUBJECT = importlib.util.module_from_spec(SPEC)
if Path(SPEC.origin).exists():
    SPEC.loader.exec_module(SUBJECT)


class Tests(unittest.TestCase):
    def test_producer_cannot_accept_implicit_auth_baseline_or_relative_root(self):
        for spec in ({}, dict(targetRoot='relative', authRows={})):
            with self.assertRaises(ValueError):
                SUBJECT.validate_spec(spec)

    def test_explicit_auth_transition_may_only_name_auth_schema(self):
        spec = dict(targetRoot='/root/baci-notification-test', approvedSnapshotPath='/private/tmp/approved.json',
            approvedSnapshotSha256='a'*64, public={}, publicRunning=False,
            expectedEvents=[], authRows={'public.customer_savings_goals': {}})
        with self.assertRaises(ValueError):
            SUBJECT.validate_spec(spec)
        spec['authRows'] = {}
        SUBJECT.validate_spec(spec)
        spec['authRows'] = {'auth.sessions': dict(before=dict(oid=1, count=1, sha256='b'*64),
            current=dict(oid=1, count=2, sha256='c'*64))}
        SUBJECT.validate_spec(spec)

    def test_actual_captured_dependencies_have_exact_pins_and_no_import_side_effect(self):
        if not Path('/private/tmp/baci-public-resume-r7.kCdy5f6F').exists():
            self.skipTest('Authenticated local public capture unavailable')
        files = SUBJECT.source_files(HERE, Path('/private/tmp/baci-public-resume-r7.kCdy5f6F'))
        self.assertNotIn('continuation_runner.py', files)
        for name in SUBJECT.DEPENDENCIES:
            self.assertEqual(hashlib.sha256(files[name]).hexdigest(), SUBJECT.cli.PINS[name])

    def test_actual_flat_package_producer_has_explicit_inspect_apply_and_never_executes(self):
        dependency = Path('/private/tmp/baci-public-resume-r7.kCdy5f6F')
        scope = Path('/private/tmp/baci-notification-scope-20261003.json')
        if not dependency.exists() or not scope.exists():
            self.skipTest('Private authenticated captures unavailable')
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)/'offline-snapshot.json'
            snapshot.write_text(json.dumps(dict(readOnly=True, financialSnapshotVersion=1)))
            spec = dict(targetRoot='/root/baci-notification-offline-test', approvedSnapshotPath=str(snapshot),
                approvedSnapshotSha256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                public={}, publicRunning=False, expectedEvents=[], authRows={})
            output = Path(directory)/'package'
            result = SUBJECT.produce(spec, dependency, scope, output)
            self.assertFalse(result['liveExecuted'])
            self.assertTrue(result['applyCommand'].endswith(' --apply'))
            self.assertNotIn('--apply', result['preflightCommand'])
            import tarfile
            with tarfile.open(output/'notification-resume.tar') as archive:
                entries = archive.getmembers()
            self.assertEqual({entry.name for entry in entries}, SUBJECT.cli.FILES | {'notification-release.json'})
            self.assertTrue(all(entry.isfile() and entry.mode == 0o600 and '/' not in entry.name for entry in entries))
            self.assertTrue(all(entry.uid == entry.gid == 0 for entry in entries))
            self.assertEqual(result['manifestSha256'], hashlib.sha256((output/'notification-release.json').read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
