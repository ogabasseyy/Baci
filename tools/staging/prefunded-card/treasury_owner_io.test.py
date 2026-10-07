import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('treasury_io', Path(__file__).with_name('treasury_owner_io.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TreasuryOwnerIo(unittest.TestCase):
    def test_private_regular_file_and_no_clobber(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'input.json'
            MODULE.write_private(path, b'private')
            self.assertEqual(MODULE.read_file(path, os.getuid(), 0o600, 30), b'private')
            with self.assertRaises(MODULE.Refused):
                MODULE.write_private(path, b'replacement')
            self.assertEqual(path.read_bytes(), b'private')

    def test_symlink_hardlink_wrong_mode_and_oversize_refuse(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'input.json'
            MODULE.write_private(path, b'private')
            linked = root / 'linked.json'
            linked.symlink_to(path)
            with self.assertRaises(MODULE.Refused):
                MODULE.read_file(linked, os.getuid(), 0o600, 30)
            linked.unlink()
            os.link(path, linked)
            with self.assertRaises(MODULE.Refused):
                MODULE.read_file(path, os.getuid(), 0o600, 30)
            linked.unlink()
            with self.assertRaises(MODULE.Refused):
                MODULE.read_file(path, os.getuid(), 0o600, 3)
            path.chmod(0o644)
            with self.assertRaises(MODULE.Refused):
                MODULE.read_file(path, os.getuid(), 0o600, 30)

    def test_private_directory_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            MODULE.private_directory(root, os.getuid())
            root.chmod(0o755)
            with self.assertRaises(MODULE.Refused):
                MODULE.private_directory(root, os.getuid())


if __name__ == '__main__':
    unittest.main()
