import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).parent))
import receipt_provenance_artifact as ARTIFACT


class ReceiptArtifact(unittest.TestCase):
    def create(self, path):
        path.mkdir(mode=0o700)
        target = path / 'intake-server.mjs'
        target.write_bytes(b'old')
        target.chmod(0o444)
        return target

    def replace(self, directory, expected=(b'old',)):
        audit = directory.parent / 'audit'
        audit.mkdir(mode=0o700, exist_ok=True)
        ARTIFACT.replace_intake_artifact(directory, b'new', expected, os.getuid(), os.getgid(), os.getuid(), audit)

    def test_replaces_only_matching_regular_file_and_preserves_readonly_mode(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'intake'
            target = self.create(directory)
            self.replace(directory)
            self.assertEqual(target.read_bytes(), b'new')
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o444)

    def test_foreign_bytes_and_symlink_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'intake'
            target = self.create(directory)
            with self.assertRaises(ARTIFACT.Refused):
                self.replace(directory, (b'foreign',))
            outside = Path(root) / 'outside'
            target.rename(outside)
            target.symlink_to(outside)
            with self.assertRaises(OSError):
                self.replace(directory)
            self.assertEqual(outside.read_bytes(), b'old')

    def test_directory_swap_does_not_redirect_privileged_write(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'intake'
            self.create(directory)
            outside = Path(root) / 'outside'
            outside_target = self.create(outside)
            original_rename = os.rename

            def swap_before_capture(source, target, **arguments):
                original_rename(directory, Path(root) / 'detached')
                directory.symlink_to(outside, target_is_directory=True)
                return original_rename(source, target, **arguments)

            with patch.object(ARTIFACT.os, 'rename', side_effect=swap_before_capture):
                self.replace(directory)
            self.assertEqual(outside_target.read_bytes(), b'old')
            self.assertEqual((Path(root) / 'detached/intake-server.mjs').read_bytes(), b'new')

    def test_file_changed_after_validation_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'intake'
            target = self.create(directory)
            original_fsync = os.fsync
            changed = False

            def change_before_publish(descriptor):
                nonlocal changed
                if not changed:
                    changed = True
                    target.chmod(0o600)
                    target.write_bytes(b'concurrent-version')
                    target.chmod(0o444)
                return original_fsync(descriptor)

            with patch.object(ARTIFACT.os, 'fsync', side_effect=change_before_publish):
                with self.assertRaises(ARTIFACT.Refused):
                    self.replace(directory)
            self.assertEqual(target.read_bytes(), b'concurrent-version')

    def test_leaf_swapped_after_final_check_is_preserved_instead_of_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'intake'
            target = self.create(directory)
            original_rename = os.rename

            def swap_at_capture(source, destination, **arguments):
                original_rename(target, directory / 'original-retained.mjs')
                target.write_bytes(b'concurrent-version')
                target.chmod(0o444)
                return original_rename(source, destination, **arguments)

            with patch.object(ARTIFACT.os, 'rename', side_effect=swap_at_capture):
                with self.assertRaises(ARTIFACT.Refused):
                    self.replace(directory)
            self.assertEqual(target.read_bytes(), b'concurrent-version')
            self.assertEqual((directory / 'original-retained.mjs').read_bytes(), b'old')

    def test_publish_never_overwrites_a_new_concurrent_entry(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'intake'
            target = self.create(directory)
            original_link = os.link

            def create_before_publish(source, destination, **arguments):
                if source == 'candidate.mjs':
                    target.write_bytes(b'concurrent-version')
                    target.chmod(0o444)
                return original_link(source, destination, **arguments)

            with patch.object(ARTIFACT.os, 'link', side_effect=create_before_publish):
                with self.assertRaises(ARTIFACT.Refused):
                    self.replace(directory)
            self.assertEqual(target.read_bytes(), b'concurrent-version')
            captured = list((Path(root) / 'audit').glob('intake-replacement.*/captured.mjs'))
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0].read_bytes(), b'old')


if __name__ == '__main__':
    unittest.main()
