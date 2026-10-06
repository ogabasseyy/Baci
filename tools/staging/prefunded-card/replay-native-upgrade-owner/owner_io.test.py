import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('owner_io', Path(__file__).with_name('owner_io.py'))
IO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IO)


class FilesTest(unittest.TestCase):
    def test_refuses_changed_pin_symlink_permissions_and_oversize(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = Path(temporary) / 'original'
            original.write_bytes(b'non-secret-fixture')
            original.chmod(0o600)
            self.assertEqual(IO.read(original, IO.digest(original.read_bytes()), uid=os.getuid()), b'non-secret-fixture')
            for options in ({'expected': '0' * 64}, {'limit': 2}, {'modes': (0o444,)}):
                with self.assertRaises(IO.Refused):
                    IO.read(original, uid=os.getuid(), **options)
            alias = Path(temporary) / 'alias'
            alias.symlink_to(original)
            with self.assertRaises(IO.Refused):
                IO.read(alias, uid=os.getuid())

    def test_refuses_existing_hardlinks_and_link_count_drift_after_open(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = Path(temporary) / 'original'
            original.write_bytes(b'non-secret-fixture')
            original.chmod(0o600)
            alias = Path(temporary) / 'hardlink'
            os.link(original, alias)
            with self.assertRaises(IO.Refused):
                IO.read(original, uid=os.getuid())
            alias.unlink()
            metadata = original.stat()
            changed = SimpleNamespace(**{name: getattr(metadata, name) for name in
                                      ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')}, st_nlink=2)
            with patch.object(IO.os, 'fstat', side_effect=[metadata, changed]):
                with self.assertRaises(IO.Refused):
                    IO.read(original, uid=os.getuid())

    def test_refuses_duplicate_json_keys(self):
        with self.assertRaises(IO.Refused):
            IO.decode(b'{"scope":1,"scope":2}')
        self.assertEqual(IO.decode(b'{"scope":1}'), {'scope': 1})

    def test_private_directory_refuses_group_write_and_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = Path(temporary) / 'directory'
            original.mkdir(mode=0o700)
            IO.directory(original, uid=os.getuid())
            original.chmod(0o770)
            with self.assertRaises(IO.Refused):
                IO.directory(original, uid=os.getuid())


if __name__ == '__main__':
    unittest.main()
