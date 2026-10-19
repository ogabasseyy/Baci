import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import public_install_io as install_io
from treasury_owner_contract import Refused


class InstallationIOTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'public'
        for name, value in (('OWNER', os.getuid()), ('GROUP', os.getgid()), ('ROOT_GROUP', os.getgid())):
            replacement = patch.object(install_io, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        for name in ('directory', 'place'):
            original = getattr(install_io, name)

            def as_owner(path, *arguments, operation=original):
                mode = path.parent.stat().st_mode & 0o777
                path.parent.chmod(mode | 0o200)
                try:
                    return operation(path, *arguments)
                finally:
                    path.parent.chmod(mode)

            replacement = patch.object(install_io, name, as_owner)
            replacement.start()
            self.addCleanup(replacement.stop)
        self.files = {'app/launch-public.cjs': b'launch', 'app/apps/web/server.js': b'server',
                      'app/empty': b'', 'config/checkout.json': b'private-checkout', 'config/anon.json': b'anon',
                      'units/baci-prefunded-public.service': b'unit'}
        self.receipt = b'{"immutable":"test"}'

    def prepare(self):
        install_io.prepare_tree(self.root, self.files, self.receipt)

    def test_exact_rerun_preserves_all_bytes_inodes_and_modes(self):
        self.prepare()
        before = {str(path): path.stat().st_ino for path in self.root.rglob('*')}
        self.prepare()
        self.assertEqual(before, {str(path): path.stat().st_ino for path in self.root.rglob('*')})
        self.assertEqual((self.root / 'config/checkout.json').stat().st_mode & 0o777, 0o440)
        self.assertEqual((self.root / 'app/empty').stat().st_mode & 0o777, 0o444)
        self.assertEqual((self.root / 'app').stat().st_mode & 0o777, 0o555)
        self.assertEqual((self.root / 'receipt.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'config').stat().st_mode & 0o777, 0o710)

    def test_rejects_foreign_existing_root_even_if_empty(self):
        self.root.mkdir(mode=0o750)
        with self.assertRaises(Refused):
            self.prepare()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_rejects_mismatch_without_clobber_or_rotation(self):
        self.prepare()
        self.files['config/checkout.json'] = b'rotated'
        with self.assertRaises(Refused):
            self.prepare()
        self.assertEqual((self.root / 'config/checkout.json').read_bytes(), b'private-checkout')
        self.files['config/checkout.json'] = b'private-checkout'
        self.receipt = b'new receipt'
        with self.assertRaises(Refused):
            self.prepare()

    def test_refuses_symlink_hardlink_permissions_and_unlisted_path(self):
        self.prepare()
        target = self.root / 'config/anon.json'
        original = target.read_bytes()
        for kind in ('symlink', 'hardlink', 'mode', 'extra'):
            with self.subTest(kind=kind):
                if kind in ('symlink', 'hardlink'):
                    target.unlink()
                    external = self.root.parent / kind
                    external.write_bytes(original)
                    external.chmod(0o440)
                    if kind == 'symlink':
                        target.symlink_to(external)
                    else:
                        os.link(external, target)
                elif kind == 'mode':
                    target.chmod(0o644)
                else:
                    (self.root / 'unlisted').write_bytes(b'extra')
                with self.assertRaises(Refused):
                    self.prepare()
                target.unlink()
                target.write_bytes(original)
                target.chmod(0o440)
                if kind == 'extra':
                    (self.root / 'unlisted').unlink()

    def test_interrupted_exact_owned_preparation_can_finish_missing_files(self):
        self.prepare()
        missing = self.root / 'app/apps/web/server.js'
        missing.parent.chmod(0o755)
        missing.unlink()
        missing.parent.chmod(0o555)
        self.prepare()
        self.assertEqual(missing.read_bytes(), b'server')

    def test_input_reader_no_follow_single_link_exact_mode_and_bounded(self):
        target = self.root.parent / 'input'
        target.write_bytes(b'input')
        target.chmod(0o600)
        with patch.object(install_io, 'root_ancestors'):
            self.assertEqual(install_io.capture(target, 5), b'input')
            with self.assertRaises(Refused):
                install_io.capture(target, 4)
            target.chmod(0o644)
            with self.assertRaises(Refused):
                install_io.capture(target, 5)


if __name__ == '__main__':
    unittest.main()
