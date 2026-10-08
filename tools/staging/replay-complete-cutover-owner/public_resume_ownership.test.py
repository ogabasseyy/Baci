import hashlib
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import public_resume as resume
import public_resume_runtime as runtime


class Tests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / 'public'
        (self.root / 'config').mkdir(parents=True)
        (self.root / 'app').mkdir()
        self.config = self.root / 'config/checkout.json'
        self.config.write_bytes(b'private fixture')
        self.anon = self.root / 'config/anon.json'
        self.anon.write_bytes(b'anon fixture')
        self.app = self.root / 'app/server.js'
        self.app.write_bytes(b'app fixture')
        self.attributes = {self.root: (65530, 0o750), self.root / 'config': (65530, 0o710),
            self.config: (65530, 0o440), self.anon: (65530, 0o440),
            self.root / 'app': (0, 0o555), self.app: (0, 0o444)}
        self.original_stat = Path.lstat
        self.original_fstat = os.fstat
        self.addCleanup(patch.stopall)
        patch.object(resume, 'ROOT', str(self.root)).start()
        patch.object(Path, 'lstat', lambda path: self.metadata(path)).start()
        patch.object(os, 'fstat', side_effect=lambda descriptor:
            self.adjust(self.current, self.original_fstat(descriptor))).start()
        self.reader = runtime.PublicRuntime()

    def adjust(self, path, info):
        fields = set(runtime.FIELDS) | {'st_uid', 'st_gid'}
        values = {field: getattr(info, field) for field in fields}
        group, mode = self.attributes.get(path, (0, stat.S_IMODE(info.st_mode) & ~0o022))
        values.update(st_uid=0, st_gid=group, st_mode=stat.S_IFMT(info.st_mode) | mode)
        if path in self.root.parents:
            values['st_mode'] = stat.S_IFDIR | 0o755
        return SimpleNamespace(**values)

    def metadata(self, path):
        return self.adjust(path, self.original_stat(path))

    def read(self, path, mode):
        self.current = path
        return self.reader.read(path, mode=mode)

    def test_installer_config_group_and_app_ancestor_are_accepted_with_real_metadata(self):
        for path, mode, group in ((self.config, 0o440, 65530), (self.anon, 0o440, 65530), (self.app, 0o444, 0)):
            with self.subTest(path=path):
                raw, metadata = self.read(path, mode)
                self.assertEqual(metadata['gid'], group)
                self.assertEqual(resume._read(self.reader.read, str(path),
                    hashlib.sha256(raw).hexdigest(), mode), raw)

    def test_wrong_config_group_and_unsafe_installer_directory_profiles_refuse(self):
        for path, attributes in ((self.config, (0, 0o440)), (self.config, (123, 0o440)),
                (self.config, (65530, 0o640)), (self.root, (123, 0o750)), (self.root, (65530, 0o770)),
                (self.root / 'config', (65530, 0o750)), (self.root / 'config', (123, 0o710))):
            with self.subTest(path=path, attributes=attributes):
                original = self.attributes[path]
                self.attributes[path] = attributes
                with self.assertRaises(ValueError):
                    self.read(self.config, 0o440)
                self.attributes[path] = original

    def test_group_exception_does_not_cover_foreign_paths_or_app_files(self):
        foreign = self.root / 'config/foreign.json'
        foreign.write_bytes(b'foreign')
        self.attributes[foreign] = (65530, 0o440)
        with self.assertRaises(ValueError):
            self.read(foreign, 0o440)
        self.attributes[self.app] = (65530, 0o444)
        with self.assertRaises(ValueError):
            self.read(self.app, 0o444)

    def test_pure_validator_rejects_fabricated_root_group_for_config(self):
        raw = b'private fixture'
        def reader(path, mode):
            return raw, dict(uid=0, gid=0, mode=mode, nlink=1, regularFile=True)
        with self.assertRaises(ValueError):
            resume._read(reader, str(self.config), hashlib.sha256(raw).hexdigest(), 0o440)


if __name__ == '__main__':
    unittest.main()
