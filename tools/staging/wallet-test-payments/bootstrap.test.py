import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import unittest


spec = importlib.util.spec_from_file_location('payment_bootstrap', Path(__file__).with_name('bootstrap.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as handle:
        for name, content, kind in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(content)
            entry.linkname = '/etc/shadow' if kind == tarfile.SYMTYPE else ''
            handle.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def sealed_files():
    entries = [('install.py', b'installer', tarfile.REGTYPE), ('bundle.json', b'{}', tarfile.REGTYPE)]
    manifest = b''.join(hashlib.sha256(content).hexdigest().encode() + b'  ' + name.encode() + b'\n' for name, content, _ in entries)
    return entries + [('SHA256SUMS', manifest, tarfile.REGTYPE)]


class BootstrapTests(unittest.TestCase):
    def test_only_verified_regular_files_are_returned(self):
        self.assertEqual(module.verify_archive(archive(sealed_files())), {'install.py': b'installer', 'bundle.json': b'{}'})

    def test_rejects_symlinks_traversal_duplicates_and_unlisted_files(self):
        for entry in [('bad', b'', tarfile.SYMTYPE), ('../bad', b'x', tarfile.REGTYPE), ('install.py', b'x', tarfile.REGTYPE), ('unlisted', b'x', tarfile.REGTYPE)]:
            with self.subTest(entry=entry[0]), self.assertRaises(RuntimeError):
                module.verify_archive(archive(sealed_files() + [entry]))

    def test_refuses_tampered_bytes_and_missing_installer(self):
        entries = sealed_files()
        entries[0] = ('install.py', b'tampered', tarfile.REGTYPE)
        with self.assertRaises(RuntimeError):
            module.verify_archive(archive(entries))
        with self.assertRaises(RuntimeError):
            module.verify_archive(archive(sealed_files()[1:]))

    def test_execution_preserves_terminal_for_hidden_credential_prompt(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as execute:
            self.assertEqual(module.activate(Path('/root/reviewed'), 'a' * 64, 'b' * 64), 0)
        self.assertNotIn('stdin', execute.call_args.kwargs)
        self.assertNotIn('PYTHONPATH', execute.call_args.kwargs['env'])
        self.assertIn('--install', execute.call_args.args[0])

    def test_nginx_recovery_never_runs_the_service_installer(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as execute:
            self.assertEqual(module.activate(Path('/root/reviewed'), 'a' * 64, 'b' * 64, recover_nginx=True), 0)
        arguments = execute.call_args.args[0]
        self.assertEqual(arguments[:2], ['/usr/bin/python3', '/root/reviewed/nginx_recover.py'])
        self.assertNotIn('--install', arguments)


if __name__ == '__main__':
    unittest.main()
