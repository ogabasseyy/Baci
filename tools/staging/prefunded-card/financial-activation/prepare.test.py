from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import prepare

ROOT = Path(__file__).resolve().parents[4]


class PreparationTests(unittest.TestCase):
    def test_missing_replay_release_refuses_without_creating_any_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'financial_replay_release_missing_rebuild_from_source_required'):
                prepare.prepare(root / 'missing', 'a' * 64, root, 'b' * 64,
                    root, ROOT, root, root / 'output')
            self.assertFalse((root / 'output').exists())

    def test_closed_package_imports_gate_and_snapshot_owner_from_unrelated_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'output'
            report = {'manifestSha256': 'a' * 64, 'outputs': {}, 'sourceCount': 2, 'sourceVerified': True}
            launcher = b'fixture-launcher'
            with patch.object(prepare, 'verify_replay', return_value=(b'{}', {}, report)), \
                    patch.object(prepare, 'verify_worker', return_value=(b'{}', {}, report)), \
                    patch.object(prepare, 'pin_read', return_value=b'{}'), \
                    patch.object(prepare, 'validate_archive', return_value={'launch-public.cjs': launcher}), \
                    patch.object(prepare, 'LAUNCHER_SHA256', prepare.digest(launcher)):
                result = prepare.prepare(root, 'a' * 64, root, 'b' * 64,
                    root, ROOT, root, output)
            self.assertFalse(result['mutationsEnabled'])
            self.assertFalse(result['financialStarted'])
            import json
            sealed = json.loads((output / 'financial-preparation.json').read_text())
            self.assertTrue(sealed['installationAdapterImplemented'])
            self.assertEqual(sealed['publicSourceManifestSha256'],
                '4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7')
            self.assertIn('public/source-manifest.json', sealed['files'])
            helpers = output / 'tooling/financial-activation'
            result = subprocess.run([sys.executable, str(helpers / 'snapshot_binding_owner.py'), '--help'],
                cwd='/', text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([sys.executable, '-c', 'import owner_gates; import replay_configuration'],
                cwd=helpers, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([sys.executable, '-c', 'import installation_runtime; import owner_adapter; import owner_public; import readiness_evidence; import readiness_evidence_io; import readiness_evidence_jwt; import readiness_evidence_roles; import readiness_evidence_runtime; import readiness_evidence_snapshot; import readiness_evidence_timers'],
                cwd=helpers, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((output / 'tooling/card-week-renewal/sealed-source.json').is_file())

    def test_preexisting_output_is_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sentinel = root / 'sentinel'
            sentinel.write_text('retained')
            with self.assertRaisesRegex(ValueError, 'financial_output_exists'):
                prepare.prepare(root, 'a' * 64, root, 'b' * 64, root, ROOT, root, root)
            self.assertEqual(sentinel.read_text(), 'retained')


if __name__ == '__main__':
    unittest.main()
