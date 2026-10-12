import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from unittest.mock import Mock


HERE = Path(__file__).resolve().parent


class Tests(unittest.TestCase):
    def setUp(self):
        specification = importlib.util.spec_from_file_location('rehearsal_seal_test', HERE/'replay_rehearsal_seal.py')
        self.subject = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.subject)

    def manifest(self):
        return dict(kind='rollback-only-replay-rehearsal',
            files={name+'.py': 'a'*64 for name in self.subject.MODULES},
            fenceInventorySha256=self.subject.FENCE_PIN,
            reviewed=dict(self.subject.REVIEWED))

    def test_rejects_unreviewed_audit_or_extra_commit_mode(self):
        for field, value in (('financialAuditSha256', 'b'*64), ('mode', 'commit')):
            manifest = self.manifest()
            manifest['reviewed'][field] = value
            with self.assertRaises(ValueError):
                self.subject.validate_manifest(manifest)

    def test_rejects_missing_or_extra_executable_source(self):
        for extra in (False, True):
            manifest = self.manifest()
            if extra:
                manifest['files']['injected.py'] = 'a'*64
            else:
                manifest['files'].pop('cutover_database.py')
            with self.assertRaises(ValueError):
                self.subject.validate_manifest(manifest)

    def test_accepts_exact_rollback_manifest(self):
        self.subject.validate_manifest(self.manifest())

    def test_rejects_duplicate_json_keys(self):
        with self.assertRaises(ValueError):
            self.subject.decode(b'{"files":{},"files":{}}')

    def test_rejects_unsealed_import_without_overwriting_it(self):
        existing = object()
        with patch.dict(sys.modules, {'cutover_runtime': existing}):
            with self.assertRaises(ValueError):
                self.subject.load_modules(HERE, {})
            self.assertIs(sys.modules['cutover_runtime'], existing)

    def test_rejects_wrong_manifest_hash_before_loading(self):
        raw = json.dumps(self.manifest()).encode()
        with patch.object(self.subject, 'protected', return_value=raw):
            with self.assertRaises(ValueError):
                self.subject.capture(HERE, 'b'*64)

    def test_rejects_unsealed_bytecode_cache_before_disk_loader(self):
        directory = Mock()
        directory.iterdir.return_value = [SimpleNamespace(name='renderer.py'), SimpleNamespace(name='__pycache__')]
        with self.assertRaises(ValueError):
            self.subject.exact_directory(directory, {'renderer.py'})
        directory.lstat.assert_not_called()

    def test_accepts_exact_private_cache_free_directory(self):
        directory = Mock()
        directory.iterdir.return_value = [SimpleNamespace(name='renderer.py')]
        directory.lstat.return_value = SimpleNamespace(st_mode=0o40700, st_uid=0, st_gid=0)
        self.subject.exact_directory(directory, {'renderer.py'})


if __name__ == '__main__':
    unittest.main()
