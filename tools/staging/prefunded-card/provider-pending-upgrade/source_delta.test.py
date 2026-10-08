import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import source_delta as delta


class SourceDeltaTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'old'
        provider = source / delta.PROVIDER
        provider.parent.mkdir(parents=True)
        old = b'prefix\n' + b"          status === 'pending' ||\n" + b'suffix\n'
        updated = b'prefix\n' + delta.ADDED_LINE + b"          status === 'pending' ||\n" + b'suffix\n'
        provider.write_bytes(old)
        manifest = {'version': 2, 'sources': {delta.PROVIDER: hashlib.sha256(old).hexdigest()},
            'rewrites': {}, 'generated': {}}
        raw = json.dumps(manifest).encode()
        (source / 'source-manifest.json').write_bytes(raw)
        replacement = root / 'provider.ts'
        replacement.write_bytes(updated)
        return source, replacement, root / 'new', raw, old, updated

    def test_copies_only_the_verified_predecessor_and_updates_one_provider_line(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            source, replacement, output, raw, old, updated = self.fixture(Path(temporary))
            with patch.multiple(delta, OLD_SOURCE_SHA=hashlib.sha256(raw).hexdigest(),
                    OLD_PROVIDER_SHA=hashlib.sha256(old).hexdigest(), PROVIDER_SHA=hashlib.sha256(updated).hexdigest()):
                result = delta.prepare_source(source, replacement, output)
            self.assertFalse(result['buildExecuted'])
            self.assertEqual((output / delta.PROVIDER).read_bytes(), updated)
            self.assertEqual((output / 'predecessor-source-manifest.json').read_bytes(), raw)

    def test_refuses_an_unreviewed_manifest_and_source_drift(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            source, replacement, output, raw, old, updated = self.fixture(Path(temporary))
            with self.assertRaisesRegex(ValueError, 'exact-installed'):
                delta.prepare_source(source, replacement, output)
            with patch.multiple(delta, OLD_SOURCE_SHA=hashlib.sha256(raw).hexdigest(),
                    OLD_PROVIDER_SHA=hashlib.sha256(old).hexdigest(), PROVIDER_SHA=hashlib.sha256(updated).hexdigest()):
                (source / delta.PROVIDER).write_bytes(old + b'ambient claim fix')
                with self.assertRaisesRegex(ValueError, 'pin-drift'):
                    delta.prepare_source(source, replacement, output)
            self.assertFalse(output.exists())

    def test_refuses_an_updated_provider_with_more_than_the_approved_line(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            source, replacement, output, raw, old, updated = self.fixture(Path(temporary))
            replacement.write_bytes(updated + b'extra')
            with patch.multiple(delta, OLD_SOURCE_SHA=hashlib.sha256(raw).hexdigest(),
                    OLD_PROVIDER_SHA=hashlib.sha256(old).hexdigest(), PROVIDER_SHA=hashlib.sha256(updated + b'extra').hexdigest()):
                with self.assertRaisesRegex(ValueError, 'one-line'):
                    delta.prepare_source(source, replacement, output)


if __name__ == '__main__':
    unittest.main()
