import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


sys.path.insert(0, str(Path(__file__).resolve().parent))
SPEC = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('install-savings-drafts-cutover.py'))
cutover = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cutover)


class ArtifactTests(unittest.TestCase):
    def build_source(self, root):
        (root / 'apps/web').mkdir(parents=True)
        (root / 'node_modules').mkdir()
        (root / 'apps/web/server.js').write_text('server')
        (root / 'node_modules/package.js').write_text('module')

    def test_manifest_hashes_files_and_records_safe_relative_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.build_source(root)
            (root / 'apps/web/link').symlink_to('../../node_modules/package.js')
            entries = cutover.artifact_entries(root)
            self.assertIn({'path': 'apps/web/server.js', 'type': 'file', 'sha256': hashlib.sha256(b'server').hexdigest()}, entries)
            self.assertIn({'path': 'apps/web/link', 'type': 'symlink', 'target': '../../node_modules/package.js'}, entries)

    def test_regression_rejects_env_files_and_escaping_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.build_source(root)
            (root / '.env.production').write_text('secret')
            with self.assertRaisesRegex(cutover.Refused, 'Environment'):
                cutover.artifact_entries(root)
            (root / '.env.production').unlink()
            (root / 'apps/web/escape').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(cutover.Refused, 'Escaping|Absolute'):
                cutover.artifact_entries(root)


class InstallationTests(unittest.TestCase):
    def test_regression_unit_escapes_date_epoch_specifier_for_systemd(self):
        with tempfile.TemporaryDirectory() as directory:
            unit_directory = Path(directory)
            with patch.object(cutover, 'UNIT_DIRECTORY', unit_directory), \
                    patch.object(cutover.os, 'chown'), \
                    patch.object(cutover.os, 'chmod'):
                cutover.write_units('public-anon-key')

            service = (unit_directory / 'baci-savings-drafts.service').read_text()
            self.assertIn('ExecCondition=/bin/sh -c \'[ \"$(/bin/date -u +%%s)\"', service)

    def test_regression_existing_destination_prevents_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'destination'
            destination.mkdir()
            with patch.object(cutover, 'DESTINATION', destination):
                with self.assertRaisesRegex(cutover.Refused, 'already exists'):
                    cutover.copy_artifact([], Path(directory))

    def test_regression_artifact_pin_failure_has_no_mutating_steps(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory)
            (bundle / 'artifact-pin.txt').write_text('0' * 64)
            entries = [{'path': 'apps/web/server.js', 'type': 'file', 'sha256': '1' * 64}]
            with patch.object(cutover, 'require_root_and_time'), \
                    patch.object(cutover, 'verify_seal'), \
                    patch('cutover_runtime.preflight_units'), \
                    patch.object(cutover, 'public_anon_key', return_value='public-key'), \
                    patch.object(cutover, 'artifact_entries', return_value=entries), \
                    patch.object(cutover, 'nginx_hash') as nginx_hash, \
                    patch.object(cutover, 'copy_artifact') as copy_artifact, \
                    patch.object(cutover, 'write_units') as write_units, \
                    patch('cutover_runtime.activate') as activate:
                with self.assertRaisesRegex(cutover.Refused, 'Artifact changed'):
                    cutover.install(bundle)
            nginx_hash.assert_not_called()
            copy_artifact.assert_not_called()
            write_units.assert_not_called()
            activate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
