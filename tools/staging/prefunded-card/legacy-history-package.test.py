import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('history_package', Path(__file__).with_name('legacy-history-package.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MigrationPackage(unittest.TestCase):
    def test_every_installed_file_is_pinned_from_the_same_inputs_and_no_services_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            for name in (*MODULE.SQL_FILES, *MODULE.PYTHON_FILES, 'collector.mjs'):
                (source / name).write_text('synthetic bytes ' + name)
            destination = source / 'bundle'
            report = MODULE.build_package(source, source / 'collector.mjs', destination)
            script = (destination / 'run-reviewed.sh').read_text()
            sums = (destination / 'SHA256SUMS').read_bytes()
            self.assertIn(hashlib.sha256(sums).hexdigest(), script)
            self.assertEqual(hashlib.sha256(script.encode()).hexdigest(), report['scriptSha256'])
            for line in sums.decode().splitlines():
                digest, name = line.split('  ')
                self.assertEqual(hashlib.sha256((destination / name).read_bytes()).hexdigest(), digest)
                self.assertEqual((destination / name).stat().st_mode & 0o777, 0o600)
            manifest = json.loads((destination / 'manifest.json').read_text())
            self.assertEqual(set(manifest['files']), set(MODULE.SQL_FILES))
            self.assertEqual(manifest['systemIdentifier'], '7685292944002592802')
            self.assertEqual(manifest['deadline'], '2026-09-29T15:59:10Z')
            self.assertNotIn('legacy-enrollment-replay-compat.sql', script)
            self.assertIn('--owner-read-only', script)
            self.assertEqual(script.count('--apply'), 2)
            self.assertIn('/root/baci-legacy-migration.', script)
            self.assertNotIn('rm ', script)
            self.assertNotIn('systemctl', script)
            self.assertNotIn('nginx', script)
            self.assertNotIn('__', script)
            subprocess.run(['/bin/bash', '-n', destination / 'run-reviewed.sh'], check=True)
            with self.assertRaises(FileExistsError):
                MODULE.build_package(source, source / 'collector.mjs', destination)

    def test_missing_input_creates_no_partial_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            with self.assertRaises(FileNotFoundError):
                MODULE.build_package(source, source / 'missing.mjs', source / 'bundle')
            self.assertFalse((source / 'bundle').exists())


if __name__ == '__main__':
    unittest.main()
