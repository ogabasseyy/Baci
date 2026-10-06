import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import installation_files as files


class InstallationFileTests(unittest.TestCase):
    def metadata(self, size, **overrides):
        values = dict(st_mode=stat.S_IFREG|0o600, st_nlink=1, st_uid=0, st_gid=0,
            st_dev=1, st_ino=2, st_size=size, st_mtime_ns=3, st_ctime_ns=4)
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_root_private_single_link_file_is_read_without_following_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'private';path.write_bytes(b'pinned')
            metadata = self.metadata(6)
            with patch.object(Path,'lstat',return_value=metadata), \
                    patch.object(files.os,'fstat',return_value=metadata):
                report, content = files.fingerprint(path)
            self.assertEqual(content,b'pinned')
            self.assertEqual(report['mode'],0o600)

    def test_metadata_or_nanosecond_drift_between_open_and_read_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'private';path.write_bytes(b'pinned')
            before = self.metadata(6)
            after = self.metadata(6,st_mtime_ns=7)
            with patch.object(Path,'lstat',return_value=before), \
                    patch.object(files.os,'fstat',side_effect=[before,after]):
                with self.assertRaisesRegex(ValueError,'changed_during_read'):
                    files.fingerprint(path)

    def test_hardlink_writable_file_and_unapproved_owner_refuse_before_open(self):
        for metadata in (self.metadata(6,st_nlink=2),self.metadata(6,st_mode=stat.S_IFREG|0o666),
                         self.metadata(6,st_uid=1001)):
            with patch.object(Path,'lstat',return_value=metadata), patch.object(files.os,'open') as opener:
                with self.subTest(metadata=metadata),self.assertRaisesRegex(ValueError,'metadata_refused'):
                    files.fingerprint(Path('/private'))
                opener.assert_not_called()

    def test_existing_candidate_is_preserved_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'candidate';path.write_bytes(b'preserved')
            with self.assertRaises(FileExistsError):
                files.place(path,b'replacement',owner=os.getuid(),group=os.getgid())
            self.assertEqual(path.read_bytes(),b'preserved')

    def test_rename_aside_unit_backup_is_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);path=root/'unit.service';audit=root/'audit';audit.mkdir()
            path.write_bytes(b'original')
            row={'sha256':'a'*64,'gid':os.getgid(),'mode':0o644}

            def place(destination,content,**kwargs):
                with destination.open('xb') as handle:handle.write(content)

            with patch.object(files,'fingerprint',return_value=(row,b'original')), \
                    patch.object(files,'place',side_effect=place):
                files.retained_replace(path,b'candidate',row,audit)
            self.assertEqual(path.read_bytes(),b'candidate')
            self.assertEqual((audit/path.name).read_bytes(),b'original')


if __name__=='__main__':
    unittest.main()
