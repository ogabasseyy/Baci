import os
from pathlib import Path
import tempfile
import unittest

from public_app_upgrade_io import exact, verify_app
from treasury_owner_contract import Refused
from treasury_owner_io import read_file


class AppTreeTests(unittest.TestCase):
    def test_pinned_empty_client_only_module_matches_the_original_installer_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'node_modules/client-only/index.js'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'')
            target.chmod(0o444)
            for parent in (target.parent, target.parent.parent, root):
                parent.chmod(0o555)
            reader = lambda path, mode, limit: read_file(path, os.getuid(), mode, limit)
            try:
                verify_app(root, {'node_modules/client-only/index.js': b''},
                           os.getuid(), os.getgid(), reader)
            finally:
                for parent in (root, target.parent.parent, target.parent):
                    parent.chmod(0o755)

    def test_empty_manifest_entry_still_rejects_nonempty_bytes_and_unsafe_attributes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'index.js'
            reader = lambda path, mode, limit: read_file(path, os.getuid(), mode, limit)
            target.write_bytes(b'foreign')
            target.chmod(0o444)
            with self.assertRaises(Refused):
                exact(target, b'', 0o444, os.getgid(), os.getuid(), reader)
            target.chmod(0o600)
            target.write_bytes(b'')
            with self.assertRaises(Refused):
                exact(target, b'', 0o444, os.getgid(), os.getuid(), reader)
            target.chmod(0o444)
            with self.assertRaises(Refused):
                exact(target, b'', 0o444, os.getgid(), os.getuid() + 1, reader)
            with self.assertRaises(Refused):
                exact(target, b'', 0o444, os.getgid() + 1, os.getuid(), reader)
            linked = root / 'link.js'
            os.link(target, linked)
            with self.assertRaises(Refused):
                exact(target, b'', 0o444, os.getgid(), os.getuid(), reader)
            linked.unlink()
            linked.symlink_to(target)
            with self.assertRaises(Refused):
                exact(linked, b'', 0o444, os.getgid(), os.getuid(), reader)

    def test_credential_reader_still_refuses_empty_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'checkout.json'
            target.write_bytes(b'')
            target.chmod(0o440)
            with self.assertRaises(Refused):
                read_file(target, os.getuid(), 0o440, 131072)

    def test_exact_readonly_tree_accepts_and_foreign_entries_or_symlinks_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'server.js'
            target.write_bytes(b'reviewed')
            target.chmod(0o444)
            root.chmod(0o555)
            reader = lambda path, mode, limit: Path(path).read_bytes()
            verify_app(root, {'server.js': b'reviewed'}, os.getuid(), os.getgid(), reader)
            root.chmod(0o755)
            target.unlink()
            target.symlink_to('outside')
            root.chmod(0o555)
            with self.assertRaises(Refused):
                verify_app(root, {'server.js': b'reviewed'}, os.getuid(), os.getgid(), reader)
            root.chmod(0o755)
            target.unlink()
            target.write_bytes(b'reviewed')
            target.chmod(0o444)
            (root / 'unlisted.js').write_bytes(b'foreign')
            root.chmod(0o555)
            with self.assertRaises(Refused):
                verify_app(root, {'server.js': b'reviewed'}, os.getuid(), os.getgid(), reader)
            root.chmod(0o755)


if __name__ == '__main__':
    unittest.main()
