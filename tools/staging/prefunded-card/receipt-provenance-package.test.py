import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


SOURCE = Path(__file__).parent
sys.path.insert(0, str(SOURCE))
SPEC = importlib.util.spec_from_file_location('receipt_package', SOURCE / 'receipt-provenance-package.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class ReceiptPackage(unittest.TestCase):
    def test_closed_hashes_root_copy_and_fresh_only_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            compiled = root / 'synthetic.mjs'
            schema = root / 'synthetic.sql'
            compiled.write_text('synthetic-code-only')
            schema.write_text('synthetic-schema-only')
            output = root / 'bundle'
            report = PACKAGE.build_package(compiled, schema, output)
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(set(manifest), set(PACKAGE.FILES))
            for name, digest in manifest.items():
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
            command = (output / 'owner-command.txt').read_text()
            self.assertIn(report['runnerSha256'], command)
            self.assertLess(command.index('/usr/bin/install'), command.index('/usr/bin/sha256sum'))
            self.assertLess(command.index('/usr/bin/sha256sum'), command.index('exec /bin/bash'))
            runner = (output / 'run-reviewed.sh').read_text()
            self.assertIn(report['checksumListSha256'], runner)
            self.assertLess(runner.index('/usr/bin/sha256sum -c SHA256SUMS'), runner.index('/usr/bin/python3'))
            self.assertNotIn('set -x', runner)
            with self.assertRaises(FileExistsError):
                PACKAGE.build_package(compiled, schema, output)


if __name__ == '__main__':
    unittest.main()
