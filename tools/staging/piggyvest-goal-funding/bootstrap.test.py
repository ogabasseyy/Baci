import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('engagement_bootstrap', Path(__file__).with_name('bootstrap.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as handle:
        for name, content, kind in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(content)
            if kind == tarfile.SYMTYPE:
                entry.linkname = '/etc/shadow'
            handle.addfile(entry, io.BytesIO(content))
    return output.getvalue()


class BootstrapTests(unittest.TestCase):
    def test_install_is_explicit_only_after_the_archive_is_verified(self):
        owner = b'approved owner\n'
        manifest = MODULE.hashlib.sha256(owner).hexdigest().encode() + b'  owner.py\n'
        content = archive([('owner.py', owner, tarfile.REGTYPE), ('SHA256SUMS', manifest, tarfile.REGTYPE)])
        with tempfile.TemporaryDirectory() as directory:
            source, destination = Path(directory) / 'bundle', Path(directory) / 'root-copy'
            source.write_bytes(content)
            source.chmod(0o600)
            destination.mkdir()
            with patch.object(MODULE, 'SOURCE', source), patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())), patch.object(MODULE.tempfile, 'mkdtemp', return_value=str(destination)), patch.object(MODULE.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as command:
                self.assertEqual(MODULE.run(MODULE.hashlib.sha256(content).hexdigest()), 0)
            self.assertEqual(command.call_args.args[0], ['/usr/bin/python3', str(destination / 'owner.py'), '--install'])

    def test_accepts_only_the_fully_hashed_flat_bundle(self):
        owner = b'approved owner\n'
        manifest = MODULE.hashlib.sha256(owner).hexdigest().encode() + b'  owner.py\n'
        result = MODULE.verify_archive(archive([
            ('owner.py', owner, tarfile.REGTYPE),
            ('SHA256SUMS', manifest, tarfile.REGTYPE),
        ]))
        self.assertEqual(result['owner.py'], owner)

    def test_rejects_symlink_traversal_and_duplicate_entries(self):
        for entries in (
            [('bad.py', b'', tarfile.SYMTYPE)],
            [('../bad.py', b'x', tarfile.REGTYPE)],
            [('bad.py', b'x', tarfile.REGTYPE), ('bad.py', b'x', tarfile.REGTYPE)],
        ):
            with self.assertRaises(RuntimeError):
                MODULE.verify_archive(archive(entries))

    def test_rejects_unlisted_and_modified_bytes(self):
        for manifest in (b'', b'0' * 64 + b'  owner.py\n'):
            with self.assertRaises(RuntimeError):
                MODULE.verify_archive(archive([
                    ('owner.py', b'changed', tarfile.REGTYPE),
                    ('SHA256SUMS', manifest, tarfile.REGTYPE),
                ]))


if __name__ == '__main__':
    unittest.main()
