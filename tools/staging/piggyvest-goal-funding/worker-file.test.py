import hashlib
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('worker_file', Path(__file__).with_name('worker-file.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class WorkerFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name).resolve()
        self.target = self.parent / 'worker.py'
        self.target.write_bytes(b'old')

    def test_fchmod_sets_exact_mode_despite_restrictive_umask(self):
        old_umask = os.umask(0o077)
        try:
            with patch.object(MODULE, 'PARENT', self.parent), patch.object(
                MODULE.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())
            ):
                MODULE.replace_codefile('worker.py', b'new', hashlib.sha256(b'old').hexdigest(),
                                        hashlib.sha256(b'new').hexdigest())
        finally:
            os.umask(old_umask)
        self.assertEqual(self.target.read_bytes(), b'new')
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o444)

    def test_refuses_predecessor_drift_and_symlink(self):
        with patch.object(MODULE, 'PARENT', self.parent), patch.object(
            MODULE.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())
        ):
            with self.assertRaises(MODULE.Refused):
                MODULE.replace_codefile('worker.py', b'new', '0' * 64, hashlib.sha256(b'new').hexdigest())
            self.target.unlink()
            self.target.symlink_to(self.parent / 'elsewhere')
            with self.assertRaises(OSError):
                MODULE.replace_codefile('worker.py', b'new', hashlib.sha256(b'old').hexdigest(),
                                        hashlib.sha256(b'new').hexdigest())

    def test_rejections_preserve_predecessor_for_owner_hardlink_and_candidate_drift(self):
        with patch.object(MODULE, 'PARENT', self.parent):
            with patch.object(MODULE.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid() + 1)):
                with self.assertRaises(MODULE.Refused):
                    MODULE.replace_codefile('worker.py', b'new', hashlib.sha256(b'old').hexdigest(),
                                            hashlib.sha256(b'new').hexdigest())
            self.assertEqual(self.target.read_bytes(), b'old')

            os.link(self.target, self.parent / 'hardlink.py')
            with patch.object(MODULE.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())):
                with self.assertRaises(MODULE.Refused):
                    MODULE.replace_codefile('worker.py', b'new', hashlib.sha256(b'old').hexdigest(),
                                            hashlib.sha256(b'new').hexdigest())
            self.assertEqual(self.target.read_bytes(), b'old')
            (self.parent / 'hardlink.py').unlink()

            with patch.object(MODULE.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())):
                with self.assertRaises(MODULE.Refused):
                    MODULE.replace_codefile('worker.py', b'new', hashlib.sha256(b'old').hexdigest(), '0' * 64)
            self.assertEqual(self.target.read_bytes(), b'old')
            self.assertEqual(list(self.parent.glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
