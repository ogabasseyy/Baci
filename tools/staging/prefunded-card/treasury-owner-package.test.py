import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('treasury_package', Path(__file__).with_name('treasury-owner-package.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TreasuryOwnerPackage(unittest.TestCase):
    def test_bundle_is_closed_and_root_copy_is_externally_pinned(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            compiled = root / 'cli.cjs'
            compiled.write_text('synthetic bundled CLI')
            output = root / 'bundle'
            result = MODULE.build_package(compiled, output)
            manifest = json.loads((output / 'manifest.json').read_text())
            for name, digest in manifest.items():
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
            runner = (output / 'run-reviewed.sh').read_text()
            self.assertIn(hashlib.sha256((output / 'SHA256SUMS').read_bytes()).hexdigest(), runner)
            self.assertLess(runner.index('sha256sum -c SHA256SUMS'), runner.index('python3'))
            self.assertIn(result['runnerSha256'], result['ownerCommand'])
            self.assertLess(result['ownerCommand'].index('install -m 0600'), result['ownerCommand'].index('sha256sum -c -'))
            self.assertLess(result['ownerCommand'].index('sha256sum -c -'), result['ownerCommand'].index('exec /bin/bash'))
            with self.assertRaises(FileExistsError):
                MODULE.build_package(compiled, output)


if __name__ == '__main__':
    unittest.main()
