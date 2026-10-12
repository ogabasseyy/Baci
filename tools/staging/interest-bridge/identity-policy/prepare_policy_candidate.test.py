import json
import os
from pathlib import Path
import tempfile
import unittest

from policy_test_fixture import policy_test_fixture
from prepare_policy_candidate import prepare_policy_candidate


NOW = '2026-10-02T11:00:00Z'


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bundle_path = self.root / 'bundle.json'
        self.pins_path = self.root / 'reviewed-pins.json'
        self.output_path = self.root / 'candidate.json'
        bundle, pins = policy_test_fixture()
        self.write(self.bundle_path, bundle)
        self.write(self.pins_path, pins)

    def write(self, path, data):
        path.write_text(json.dumps(data))
        path.chmod(0o600)

    def prepare(self):
        return prepare_policy_candidate(self.bundle_path, self.pins_path, self.output_path, NOW)

    def test_prepares_private_inactive_artifact_and_reuses_identical_output(self):
        report, status = self.prepare()
        original = self.output_path.read_bytes()
        metadata = self.output_path.stat()
        repeated, repeated_status = self.prepare()
        self.assertEqual(status, 'created')
        self.assertEqual(repeated_status, 'duplicate')
        self.assertEqual(report, repeated)
        self.assertEqual(original, self.output_path.read_bytes())
        self.assertEqual(metadata.st_ino, self.output_path.stat().st_ino)
        self.assertEqual(metadata.st_mtime_ns, self.output_path.stat().st_mtime_ns)
        self.assertEqual(metadata.st_mode & 0o777, 0o600)

    def test_conflicting_existing_artifact_is_preserved_without_overwrite(self):
        self.prepare()
        original = self.output_path.read_bytes()
        bundle = json.loads(self.bundle_path.read_text())
        bundle['evidence'] = []
        self.write(self.bundle_path, bundle)
        with self.assertRaisesRegex(ValueError, 'existing-artifact-conflict'):
            self.prepare()
        self.assertEqual(original, self.output_path.read_bytes())

    def test_refusal_artifact_has_missing_evidence_and_no_candidate(self):
        bundle = json.loads(self.bundle_path.read_text())
        bundle['evidence'] = []
        self.write(self.bundle_path, bundle)
        report, _ = self.prepare()
        self.assertEqual(report['status'], 'refused')
        self.assertIsNone(report['candidate'])
        self.assertEqual(len(report['missingEvidence']), 7)
        self.assertFalse(report['changesMade'])

    def test_input_and_output_symlinks_are_refused(self):
        target = self.root / 'target.json'
        self.write(target, {})
        self.output_path.symlink_to(target)
        with self.assertRaises(OSError):
            self.prepare()
        self.assertEqual(target.read_text(), '{}')
        self.output_path.unlink()
        self.bundle_path.unlink()
        self.bundle_path.symlink_to(target)
        with self.assertRaises(OSError):
            self.prepare()

    def test_refuses_public_review_registry_and_hardlinked_inputs(self):
        self.pins_path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private-input-invalid'):
            self.prepare()
        self.pins_path.chmod(0o600)
        os.link(self.bundle_path, self.root / 'bundle-link.json')
        with self.assertRaisesRegex(ValueError, 'private-input-invalid'):
            self.prepare()

    def test_refuses_oversized_input_before_parsing(self):
        self.bundle_path.write_bytes(b' ' * 65537)
        with self.assertRaisesRegex(ValueError, 'private-input-invalid'):
            self.prepare()

    def test_refuses_duplicate_keys_and_nonfinite_json_before_verification(self):
        for content in ('{"scope":{},"scope":{}}', '{"value":NaN}'):
            self.bundle_path.write_text(content)
            with self.assertRaises(ValueError):
                self.prepare()
            self.assertFalse(self.output_path.exists())


if __name__ == '__main__':
    unittest.main()
