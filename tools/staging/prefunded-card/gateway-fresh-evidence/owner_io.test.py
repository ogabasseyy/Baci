import stat
from types import SimpleNamespace
import unittest

from owner_io import ProtectedFiles


class Tests(unittest.TestCase):
    def valid(self):
        return SimpleNamespace(st_mode=stat.S_IFREG | 0o440, st_uid=0, st_gid=984,
            st_nlink=1, st_size=100, st_dev=1, st_ino=2, st_mtime_ns=3, st_ctime_ns=4)

    def test_actual_root_gid984_mode440_link1_contract(self):
        ProtectedFiles.metadata(self.valid(), (0o440,), (984,))

    def test_owner_group_mode_hardlinks_symlinks_and_unbounded_files_refuse(self):
        for field, value in [('st_uid', 501), ('st_gid', 0), ('st_nlink', 2), ('st_size', 0),
                ('st_size', 262145), ('st_mode', stat.S_IFLNK | 0o440), ('st_mode', stat.S_IFREG | 0o640)]:
            with self.subTest(field=field):
                info = self.valid()
                setattr(info, field, value)
                with self.assertRaises(ValueError):
                    ProtectedFiles.metadata(info, (0o440,), (984,))

    def test_same_bytes_but_replaced_inode_or_metadata_is_not_unchanged(self):
        original = self.valid()
        for field in ('st_ino', 'st_mode', 'st_gid', 'st_nlink', 'st_mtime_ns', 'st_ctime_ns'):
            changed = self.valid()
            setattr(changed, field, getattr(changed, field) + 1)
            self.assertNotEqual(ProtectedFiles.fingerprint(original), ProtectedFiles.fingerprint(changed))

    def test_owner_sources_require_exact_mode600_group0_single_link(self):
        info = self.valid()
        info.st_mode = stat.S_IFREG | 0o600
        info.st_gid = 0
        ProtectedFiles.metadata(info, (0o600,), (0,))
        with self.assertRaises(ValueError):
            ProtectedFiles.metadata(info, (0o440,), (984,))


if __name__ == '__main__':
    unittest.main()
