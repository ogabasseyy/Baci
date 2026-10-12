import errno
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wallet_test_install_io', Path(__file__).with_name('install_io.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InstallIoTests(unittest.TestCase):
    def test_service_root_stays_traversable_under_owner_bootstrap_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'service'
            previous = os.umask(0o077)
            try:
                metadata = MODULE.create_service_root(root)
            finally:
                os.umask(previous)
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o755)
            with self.assertRaises(FileExistsError):
                MODULE.create_service_root(root)

    def test_root_file_read_refuses_symlink_open(self):
        parent = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        with (
            patch.object(Path, 'lstat', return_value=parent),
            patch.object(MODULE.os, 'open', side_effect=OSError(errno.ELOOP, 'symlink')) as open_file,
        ):
            with self.assertRaises(OSError):
                MODULE.read_root_file(Path('/root/bundle/server.cjs'))
        self.assertTrue(open_file.call_args.args[1] & MODULE.os.O_NOFOLLOW)

    def test_bundle_rejects_non_root_private_location(self):
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.load_bundle(Path('/tmp/bundle'), '0' * 64)

    def test_secret_rejects_embedded_newline(self):
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.write_secret(Path('/etc/baci/staging-test-payments/paystack-secret'), 'sk_test_bad\nvalue')

    def test_existing_newline_credential_is_not_accepted_as_the_runtime_value(self):
        metadata = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        with (
            patch.object(Path, 'mkdir'),
            patch.object(Path, 'stat', return_value=metadata),
            patch.object(Path, 'exists', return_value=True),
            patch.object(MODULE, 'read_root_file', return_value=b'sk_test_old\n'),
        ):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.write_secret(Path('/etc/baci/staging-test-payments/paystack-secret'), 'sk_test_old')


if __name__ == '__main__':
    unittest.main()
