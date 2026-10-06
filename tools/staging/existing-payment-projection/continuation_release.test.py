import hashlib
import importlib.util
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent


class ContinuationReleaseTests(unittest.TestCase):
    def setUp(self):
        specification = importlib.util.spec_from_file_location('continuation_release',
            HERE / 'continuation_release.py')
        self.subject = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.subject)
        self.directory = Path('/root/continuation-fixture')
        self.contents = {name: b'pass\n' for name in self.subject.FILES}
        self.manifest = dict(kind=self.subject.KIND, operationId=self.subject.OPERATION,
            executionDeadline=self.subject.DEADLINE,
            files={name: hashlib.sha256(raw).hexdigest() for name, raw in self.contents.items()})

    def capture(self, manifest=None):
        raw = json.dumps(manifest or self.manifest).encode()
        pin = hashlib.sha256(raw).hexdigest()
        def read(path, expected):
            return raw if path.name == 'release.json' else self.contents[path.name]
        with patch.object(self.subject, 'protected_bytes', side_effect=read):
            return self.subject.capture_release(self.directory, pin)

    def test_exact_source_closure_requires_parent_root_adapter_before_import(self):
        captured = self.capture()
        self.assertEqual(captured, self.contents)
        self.assertIn('continuation_root.py', captured)
        self.assertIn('financial_snapshot.sql', captured)

    def test_missing_extra_or_path_traversal_input_refuses(self):
        for name in ('continuation_root.py', '../foreign.py', 'unknown.py'):
            manifest = json.loads(json.dumps(self.manifest))
            if name == 'continuation_root.py':
                del manifest['files'][name]
            else:
                manifest['files'][name] = 'a' * 64
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
                self.capture(manifest)

    def test_source_bytes_drift_is_not_accepted_even_with_claimed_read_pin(self):
        self.contents['projection_sql.py'] += b'COMMIT;'
        with self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
            self.capture()

    def test_unknown_manifest_fields_wrong_scope_or_deadline_refuse(self):
        for field, value in (('unknown', True), ('operationId', 'foreign'),
            ('executionDeadline', '2099-01-01T00:00:00Z'), ('kind', 'generic-financial-runner')):
            manifest = dict(self.manifest, **{field: value})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
                self.capture(manifest)

    def test_duplicate_keys_and_nonfinite_json_refuse(self):
        for raw in ('{"kind":"one","kind":"two"}', '{"files":NaN}'):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
                self.subject.decode(raw.encode())

    def test_unsealed_callback_origin_refuses(self):
        adapter = Mock()
        with self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
            self.subject.checked_root(adapter, self.directory)

    def test_ambient_module_cannot_replace_a_sealed_dependency(self):
        with patch.dict(self.subject.sys.modules, {'financial_completion': Mock()}), \
            self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
            self.subject.load_modules(self.directory, self.contents)

    def test_pending_local_package_cannot_activate_without_root_adapter(self):
        del self.contents['continuation_root.py']
        with self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
            self.capture()

    def protected_fixture(self, file_changes=None, parent_changes=None, opened_changes=None):
        fields = dict(st_dev=1, st_ino=2, st_uid=0, st_gid=0, st_nlink=1,
            st_size=5, st_mtime_ns=1, st_ctime_ns=1, st_mode=stat.S_IFREG | 0o600)
        file_info = SimpleNamespace(**dict(fields, **(file_changes or {})))
        parent_info = SimpleNamespace(**{**fields, 'st_mode': stat.S_IFDIR | 0o700,
            **(parent_changes or {})})
        opened = SimpleNamespace(**dict(fields, **(opened_changes or file_changes or {})))
        handle = Mock()
        handle.read.return_value = b'pass\n'
        handle.fileno.return_value = 100
        manager = Mock()
        manager.__enter__ = Mock(return_value=handle)
        manager.__exit__ = Mock(return_value=False)
        observed = lambda path: file_info if path.name == 'entry.py' else parent_info
        with patch.object(Path, 'lstat', observed), patch.object(self.subject.os, 'open', return_value=100) as opening, \
            patch.object(self.subject.os, 'fdopen', return_value=manager), \
            patch.object(self.subject.os, 'fstat', return_value=opened):
            raw = self.subject.protected_bytes(self.directory/'entry.py', hashlib.sha256(b'pass\n').hexdigest())
            self.assertTrue(opening.call_args[0][1] & self.subject.os.O_NOFOLLOW)
            return raw

    def test_protected_descriptor_requires_exact_root_metadata(self):
        self.assertEqual(self.protected_fixture(), b'pass\n')
        for changes in (dict(st_uid=501), dict(st_gid=501), dict(st_nlink=2),
            dict(st_mode=stat.S_IFREG | 0o644), dict(st_mode=stat.S_IFLNK | 0o600)):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
                self.protected_fixture(file_changes=changes)

    def test_parent_writability_and_descriptor_replacement_refuse(self):
        with self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
            self.protected_fixture(parent_changes=dict(st_mode=stat.S_IFDIR | 0o777))
        with self.assertRaisesRegex(ValueError, '^continuation_release_refused$'):
            self.protected_fixture(opened_changes=dict(st_ino=3))


if __name__ == '__main__':
    unittest.main()
