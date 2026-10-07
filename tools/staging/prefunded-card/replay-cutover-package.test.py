import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('cutover_package', HERE / 'replay-cutover-package.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class ReplayCutoverPackage(unittest.TestCase):
    def test_bundle_hashes_captured_bytes_before_owner_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / 'artifact'
            artifact.mkdir()
            outputs = {}
            for name in ('replay-daemon.mjs', 'prefunded-replay-bundle.mjs'):
                content = ('bundle-' + name).encode()
                (artifact / name).write_bytes(content)
                outputs[name] = hashlib.sha256(content).hexdigest()
            (artifact / 'replay-artifact.manifest.json').write_text(json.dumps({'outputs': outputs}))
            with patch.object(PACKAGE, 'FILES', ('replay-daemon.mjs', 'prefunded-replay-bundle.mjs')), \
                    patch.object(PACKAGE, 'REVIEWED_OUTPUTS', outputs, create=True):
                report = PACKAGE.build_package(artifact, root / 'output')
                directory = Path(report['directory'])
                runner = (directory / 'run-reviewed.sh').read_bytes()
                self.assertEqual(hashlib.sha256(runner).hexdigest(), report['runnerSha256'])
                self.assertIn(report['checksumListSha256'], runner.decode())
                self.assertLess(runner.find(b'sha256sum -c SHA256SUMS'), runner.find(b'python3 -B'))
                self.assertEqual(json.loads((directory / 'manifest.json').read_text()), outputs)
                self.assertIn(report['runnerSha256'], (directory / 'owner-command.txt').read_text())

    def test_changed_bundle_is_refused_before_package_directory_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / 'artifact'
            artifact.mkdir()
            (artifact / 'replay-artifact.manifest.json').write_text(json.dumps({'outputs': {
                'replay-daemon.mjs': 'a' * 64, 'prefunded-replay-bundle.mjs': 'b' * 64}}))
            (artifact / 'replay-daemon.mjs').write_text('wrong')
            (artifact / 'prefunded-replay-bundle.mjs').write_text('wrong')
            with self.assertRaises(ValueError):
                PACKAGE.build_package(artifact, root / 'output')
            self.assertFalse((root / 'output').exists())

    def test_refuses_forged_bundles_with_self_consistent_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outputs = {}
            for name in ('replay-daemon.mjs', 'prefunded-replay-bundle.mjs'):
                content = b'forged-but-matching'
                (root / name).write_bytes(content)
                outputs[name] = hashlib.sha256(content).hexdigest()
            (root / 'replay-artifact.manifest.json').write_text(json.dumps({'outputs': outputs}))
            with self.assertRaises(ValueError):
                PACKAGE.build_package(root, root / 'output')
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
