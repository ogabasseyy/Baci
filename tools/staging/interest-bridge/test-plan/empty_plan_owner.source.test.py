import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import empty_plan_owner as owner


class SourceManifestTests(unittest.TestCase):
    def test_complete_source_manifest_is_required_and_tampered_sources_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'synthetic.py'
            source.write_bytes(b'synthetic-local-fixture')
            source.chmod(0o600)
            checksum = hashlib.sha256(source.read_bytes()).hexdigest()
            manifest = (checksum + '  synthetic.py\n').encode()
            (root / 'SOURCE-SHA256SUMS').write_bytes(manifest)
            original_stat = Path.lstat

            def root_stat(path):
                values = list(original_stat(path))
                values[4] = 0
                return os.stat_result(values)

            with patch.object(owner, 'ROOT', root), patch.object(Path, 'lstat', root_stat), \
                    patch.object(owner, 'read_sealed', return_value=manifest):
                owner._source('a'*64)
                source.write_bytes(b'changed-source')
                with self.assertRaisesRegex(ValueError, 'source-pin'):
                    owner._source('a'*64)
                source.write_bytes(b'synthetic-local-fixture')
                source.chmod(0o622)
                with self.assertRaisesRegex(ValueError, 'source-pin'):
                    owner._source('a'*64)
                source.chmod(0o600)
                (root / 'unlisted.sql').write_text('synthetic')
                with self.assertRaisesRegex(ValueError, 'source-manifest-incomplete'):
                    owner._source('a'*64)

    def test_duplicate_or_path_traversal_manifest_records_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'synthetic.py').write_text('synthetic')
            (root / 'synthetic.py').chmod(0o600)
            (root / 'SOURCE-SHA256SUMS').write_text('synthetic')
            checksum = hashlib.sha256(b'synthetic').hexdigest()
            original_stat = Path.lstat

            def root_stat(path):
                values = list(original_stat(path))
                values[4] = 0
                return os.stat_result(values)

            for manifest in (checksum + '  ../synthetic.py\n',
                             (checksum + '  synthetic.py\n')*2):
                with patch.object(owner, 'ROOT', root), \
                        patch.object(Path, 'lstat', root_stat), \
                        patch.object(owner, 'read_sealed', return_value=manifest.encode()):
                    with self.assertRaisesRegex(ValueError, 'source-manifest-shape'):
                        owner._source('a'*64)


if __name__ == '__main__':
    unittest.main()
