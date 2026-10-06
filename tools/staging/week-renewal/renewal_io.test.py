import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import renewal_io as secure_io
from renewal_contract import Refused, digest


class InputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / 'file'
        self.path.write_bytes(b'private-secret')
        self.path.chmod(0o600)
        self.parents = patch.object(secure_io, 'trusted_parents')
        self.parents.start()
        self.addCleanup(self.parents.stop)

    def read(self, path=None, expected=None):
        return secure_io.read_verified(path or self.path, (0o600,), (os.getegid(),),
                                       expected, owner=os.geteuid())

    def test_real_descriptor_reads_exact_hash_without_echoing_bytes(self):
        value, metadata = self.read(expected=digest(b'private-secret'))
        self.assertEqual(value, b'private-secret')
        secure_io.unchanged(self.path, metadata)
        with self.assertRaisesRegex(Refused, 'source-pin'):
            self.read(expected='0' * 64)

    def test_symlink_hardlink_writable_empty_and_wrong_group_refuse(self):
        link = self.root / 'link'
        link.symlink_to(self.path)
        with self.assertRaises(OSError):
            self.read(link)
        link.unlink()
        os.link(self.path, link)
        with self.assertRaises(Refused):
            self.read()
        link.unlink()
        self.path.chmod(0o660)
        with self.assertRaises(Refused):
            self.read()
        self.path.chmod(0o600)
        with self.assertRaises(Refused):
            secure_io.read_verified(self.path, (0o600,), (-1,), owner=os.geteuid())
        self.path.write_bytes(b'')
        with self.assertRaises(Refused):
            self.read()

    def test_replaced_path_after_descriptor_read_refuses(self):
        real_fdopen = os.fdopen
        target = self.path
        class ReplacingReader:
            def __init__(self, descriptor, mode):
                self.handle = real_fdopen(descriptor, mode)
            def __enter__(self):
                return self
            def __exit__(self, *arguments):
                return self.handle.__exit__(*arguments)
            def fileno(self):
                return self.handle.fileno()
            def read(self, limit):
                content = self.handle.read(limit)
                replacement = target.with_name('replacement')
                replacement.write_bytes(b'replaced-during-read')
                replacement.chmod(0o600)
                replacement.replace(target)
                return content
        with patch.object(secure_io.os, 'fdopen', ReplacingReader):
            with self.assertRaisesRegex(Refused, 'source-changed'):
                self.read()
        self.assertEqual(target.read_bytes(), b'replaced-during-read')

    def test_source_inode_or_mode_change_before_backup_refuses(self):
        _, info = self.read()
        self.path.chmod(0o400)
        with self.assertRaisesRegex(Refused, 'before-backup'):
            secure_io.unchanged(self.path, info)


class OutputTests(unittest.TestCase):
    def test_private_preparation_retains_every_original_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(secure_io, 'private_directory'):
                final = secure_io.publish_preparation(root, {'original': b'old-secret'}, {'candidate': b'new-secret'}, b'{}')
                for path in final.rglob('*'):
                    self.assertEqual(path.stat().st_mode & 0o777, 0o700 if path.is_dir() else 0o600)
                self.assertEqual((final / 'original/original').read_bytes(), b'old-secret')
                with self.assertRaisesRegex(Refused, 'retained'):
                    secure_io.publish_preparation(root, {'original': b'overwrite'}, {}, b'{}')
                self.assertEqual((final / 'original/original').read_bytes(), b'old-secret')

    def test_failed_write_retains_pending_and_retry_refuses_without_delete(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(secure_io, 'private_directory'), patch.object(secure_io, 'write_private', side_effect=OSError('secret')):
                with self.assertRaises(OSError):
                    secure_io.publish_preparation(root, {'original': b'old'}, {}, b'{}')
            self.assertTrue((root / 'lane-a-preparation.pending').is_dir())
            with patch.object(secure_io, 'private_directory'):
                with self.assertRaisesRegex(Refused, 'retained'):
                    secure_io.publish_preparation(root, {}, {}, b'{}')


if __name__ == '__main__':
    unittest.main()
