import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('worker_package', Path(__file__).with_name('runtime-workers-package.py'))
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class WorkerPackageTests(unittest.TestCase):
    def test_every_byte_is_pinned_before_root_installer_and_no_output_is_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary) / 'artifact'
            artifact.mkdir()
            outputs = {name: b'process.exit(0);\n' for name in PACKAGE.REVIEWED_OUTPUTS}
            pins = {name: hashlib.sha256(content).hexdigest() for name, content in outputs.items()}
            for name, content in outputs.items():
                (artifact / name).write_bytes(content)
            (artifact / 'artifact.manifest.json').write_text(json.dumps({'outputs': pins}))
            destination = Path(temporary) / 'owner'
            with patch.object(PACKAGE, 'REVIEWED_OUTPUTS', pins):
                result = PACKAGE.build_package(artifact, destination)
            manifest = json.loads((destination / 'manifest.json').read_bytes())
            self.assertEqual(set(manifest), set(PACKAGE.FILES))
            for name, digest in manifest.items():
                self.assertEqual(hashlib.sha256((destination / name).read_bytes()).hexdigest(), digest)
            runner = (destination / 'run-reviewed.sh').read_text()
            self.assertLess(runner.index('sha256sum -c SHA256SUMS'), runner.index('/usr/bin/python3'))
            self.assertIn(result['runnerSha256'], result['ownerCommand'])
            self.assertIn('PREFUNDED_WORKERS_SCHEDULED', runner)
            self.assertNotIn('rm ', runner)
            with patch.object(PACKAGE, 'REVIEWED_OUTPUTS', pins):
                with self.assertRaises(FileExistsError):
                    PACKAGE.build_package(artifact, destination)

    def test_changed_compiled_artifact_cannot_supply_its_own_trust_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary)
            outputs = {name: hashlib.sha256(b'forged').hexdigest() for name in PACKAGE.REVIEWED_OUTPUTS}
            (artifact / 'artifact.manifest.json').write_text(json.dumps({'outputs': outputs}))
            target = artifact / 'owner'
            with self.assertRaisesRegex(ValueError, 'artifact'):
                PACKAGE.build_package(artifact, target)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
