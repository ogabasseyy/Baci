import os
from pathlib import Path
import tempfile
import unittest

from worker_contract import InstallError
from worker_install_io import ensure_directory, read_fixed, write_fixed


class WorkerInstallIOTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        self.owner = os.getuid()
        (self.root / 'opt').mkdir(mode=0o755)

    def tearDown(self):
        self.temporary.cleanup()

    def test_atomic_fixed_file_write_is_exact_and_idempotent(self):
        target = self.root / 'opt/worker.conf'
        self.assertTrue(write_fixed(target, b'approved\n', self.root, self.owner, 0o444))
        self.assertFalse(write_fixed(target, b'approved\n', self.root, self.owner, 0o444))
        self.assertEqual(read_fixed(target, self.root, self.owner, 0o444), b'approved\n')
        self.assertEqual(target.stat().st_nlink, 1)
        self.assertEqual(set(path.name for path in target.parent.iterdir()), {'worker.conf'})
        with self.assertRaisesRegex(InstallError, 'Nonmatching existing destination'):
            write_fixed(target, b'replace not permitted', self.root, self.owner, 0o444)
        self.assertEqual(target.read_bytes(), b'approved\n')

    def test_refuses_symlink_destination_and_untrusted_parent(self):
        target = self.root / 'opt/worker.conf'
        outside = self.root / 'opt/outside'
        outside.write_bytes(b'keep')
        target.symlink_to(outside)
        with self.assertRaises(InstallError):
            read_fixed(target, self.root, self.owner, 0o444)
        target.unlink()
        (self.root / 'opt').chmod(0o775)
        with self.assertRaisesRegex(InstallError, 'Untrusted destination parent'):
            write_fixed(target, b'no', self.root, self.owner, 0o444)
        self.assertEqual(outside.read_bytes(), b'keep')

    def test_directory_creation_and_existing_mode_validation(self):
        destination = self.root / 'opt/private'
        self.assertTrue(ensure_directory(destination, self.root, self.owner, 0o700))
        self.assertFalse(ensure_directory(destination, self.root, self.owner, 0o700))
        destination.chmod(0o755)
        with self.assertRaisesRegex(InstallError, 'Unsafe existing directory'):
            ensure_directory(destination, self.root, self.owner, 0o700)


if __name__ == '__main__':
    unittest.main()
