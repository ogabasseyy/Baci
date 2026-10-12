import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from connectivity_io import replace_owned
from renewal_contract import Refused, digest
from renewal_io import read_verified


class ConnectivityReplacementTests(unittest.TestCase):
    def replace(self, path, previous, content):
        def read(filename, modes, groups, expected):
            with patch('renewal_io.trusted_parents'):
                return read_verified(filename, modes, groups, expected, owner=os.geteuid())
        with patch('connectivity_io.trusted_parents'), patch('connectivity_io.read_verified', side_effect=read):
            return replace_owned(path, previous, content, 0o640, os.getgid(), owner=os.geteuid())

    def test_atomic_replacement_preserves_permissions_and_returns_candidate_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'binding'
            path.write_bytes(b'original')
            path.chmod(0o640)
            result = self.replace(path, digest(b'original'), b'candidate')
            self.assertEqual(result, digest(b'candidate'))
            self.assertEqual(path.read_bytes(), b'candidate')
            self.assertEqual(path.stat().st_mode & 0o7777, 0o640)
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_pin_drift_symlink_and_hardlink_never_overwrite_foreign_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'binding'
            path.write_bytes(b'foreign')
            path.chmod(0o640)
            with self.assertRaises(Refused):
                self.replace(path, digest(b'original'), b'candidate')
            self.assertEqual(path.read_bytes(), b'foreign')
            alias = root / 'alias'
            alias.symlink_to(path)
            with self.assertRaises((Refused, OSError)):
                self.replace(alias, digest(b'foreign'), b'candidate')
            alias.unlink()
            os.link(path, alias)
            with self.assertRaises(Refused):
                self.replace(path, digest(b'foreign'), b'candidate')
            self.assertEqual(path.read_bytes(), b'foreign')

    def test_failed_compare_before_rename_leaves_original_and_no_residue(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'binding'
            path.write_bytes(b'original')
            path.chmod(0o640)
            with patch('connectivity_io.unchanged', side_effect=Refused('changed')):
                with self.assertRaises(Refused):
                    self.replace(path, digest(b'original'), b'candidate')
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual(list(path.parent.iterdir()), [path])


if __name__ == '__main__':
    unittest.main()
