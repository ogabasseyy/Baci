import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import public_nginx_installation as installation


class AtomicRaceTests(unittest.TestCase):
    def test_install_and_rollback_refuse_changes_during_temporary_file_preparation(self):
        for original, replacement in ((b'before', b'candidate'), (b'candidate', b'before')):
            with self.subTest(original=original), tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / 'config'
                target.write_bytes(original)
                target.chmod(0o400)
                metadata = target.stat()
                real_fsync = os.fsync

                def fsync(descriptor):
                    target.chmod(0o600)
                    target.write_bytes(b'concurrent-owner-change')
                    target.chmod(0o400)
                    real_fsync(descriptor)

                with patch.object(installation, 'TARGET', target), \
                        patch.object(installation, '_read_target', side_effect=lambda: (target.read_bytes(), target.stat())), \
                        patch.object(installation.os, 'fchown'), patch.object(installation.os, 'fsync', side_effect=fsync):
                    with self.assertRaises(installation.Refused):
                        installation._atomic_write(replacement, metadata, original, metadata)
                self.assertEqual(target.read_bytes(), b'concurrent-owner-change')
                self.assertEqual(list(Path(directory).iterdir()), [target])


if __name__ == '__main__':
    unittest.main()
