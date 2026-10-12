import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import checkout_retirement_bundle as bundle


class BundleTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory)
        pins = dict(oldArchiveSha256=bundle.OLD_ARCHIVE_SHA256, oldManifestSha256=bundle.OLD_MANIFEST_SHA256,
                    archiveSha256='a' * 64, manifestSha256='b' * 64, deadline=bundle.DEADLINE)
        for name in bundle.ARTIFACTS:
            (root / name).write_bytes(json.dumps(pins).encode() if name == 'pins.json' else name.encode())
        return root

    def test_bundle_seals_imports_sql_and_artifacts_before_owner_execution(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bundle, 'validate_archive') as validate:
            root = self.fixture(directory)
            report = bundle.build_package(root, root / 'sealed')
            sealed = root / 'sealed'
            validate.assert_called()
            self.assertEqual(validate.call_count, 2)
            sums = (sealed / 'SHA256SUMS').read_bytes()
            self.assertEqual(hashlib.sha256(sums).hexdigest(), report['checksumListSha256'])
            for line in sums.decode().splitlines():
                expected, name = line.split('  ')
                self.assertEqual(hashlib.sha256((sealed / name).read_bytes()).hexdigest(), expected)
                self.assertEqual((sealed / name).stat().st_mode & 0o777, 0o600)
            for name in ('checkout_retirement_owner.py', 'public_app_upgrade.py', 'phone_email_contract.py',
                         'public_projection.py', 'storage.sql', 'checkout-retirement-apply.sql',
                         'checkout_retirement_quiescence.py', 'runtime_scheduler.py'):
                self.assertTrue((sealed / name).is_file(), name)
            runner = (sealed / 'run-reviewed.sh').read_text()
            self.assertLess(runner.index('/usr/bin/sha256sum -c SHA256SUMS'), runner.index('/usr/bin/python3'))
            self.assertIn('-I -B', runner)
            launcher = (sealed / 'activation-retire-checkout.sh').read_text()
            self.assertIn(report['runnerSha256'], launcher)
            self.assertIn(report['remoteDirectory'], launcher)
            self.assertNotIn('sudo -n', launcher)
            for name, shell in (('run-reviewed.sh', '/bin/bash'), ('activation-retire-checkout.sh', '/bin/sh')):
                subprocess.run([shell, '-n', str(sealed / name)], check=True)

    def test_wrong_deadline_or_artifact_symlink_refuses_before_bundle_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            path = root / 'pins.json'
            pins = json.loads(path.read_text())
            pins['deadline'] = '2030-01-01T00:00:00Z'
            path.write_text(json.dumps(pins))
            with self.assertRaises(ValueError):
                bundle.build_package(root, root / 'sealed')
            self.assertFalse((root / 'sealed').exists())
            (root / 'public-app.tar.gz').unlink()
            (root / 'public-app.tar.gz').symlink_to(root / 'old-public-app.tar.gz')
            with self.assertRaises(ValueError):
                bundle.build_package(root, root / 'sealed')


if __name__ == '__main__':
    unittest.main()
