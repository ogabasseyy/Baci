import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('runtime_package', Path(__file__).with_name('runtime-preparation-package.py'))
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class RuntimePreparationPackageTests(unittest.TestCase):
    def test_diagnostic_bundle_runs_only_readiness_with_existing_private_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            compiled = Path(directory) / 'readiness.cjs'
            compiled.write_text('process.exit(0);\n')
            target = Path(directory) / 'bundle'
            with patch.object(PACKAGE, 'READINESS_SHA256', hashlib.sha256(compiled.read_bytes()).hexdigest()):
                result = PACKAGE.build_package(compiled, target, diagnostic_only=True)
            self.assertEqual(result['remoteDirectory'], PACKAGE.DIAGNOSTIC_REMOTE)
            self.assertEqual(set(json.loads((target / 'manifest.json').read_text())), {'runtime-readiness-cli.cjs'})
            runner = (target / 'run-reviewed.sh').read_text()
            self.assertIn('/usr/bin/node "$root_dir/runtime-readiness-cli.cjs" --connect /etc/baci/prefunded-card/activation.prepared.json', runner)
            self.assertLess(runner.index('sha256sum -c SHA256SUMS'), runner.index('/usr/bin/node'))
            for prohibited in ('python', '.sql', 'systemctl', 'docker', 'runtime-preparation-owner', 'RESTRICTED_RUNTIME_PREPARED'):
                self.assertNotIn(prohibited, runner)
            self.assertIn(result['runnerSha256'], result['ownerCommand'])

    def test_bundle_pins_every_file_before_root_execution_and_keeps_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            compiled = Path(directory) / 'readiness.cjs'
            compiled.write_text('process.exit(0);\n')
            target = Path(directory) / 'bundle'
            with patch.object(PACKAGE, 'READINESS_SHA256', hashlib.sha256(compiled.read_bytes()).hexdigest()):
                result = PACKAGE.build_package(compiled, target)
            manifest = json.loads((target / 'manifest.json').read_bytes())
            self.assertEqual(set(manifest), set(PACKAGE.OWNER.FILES))
            for name, checksum in manifest.items():
                self.assertEqual(hashlib.sha256((target / name).read_bytes()).hexdigest(), checksum)
                self.assertEqual((target / name).stat().st_mode & 0o777, 0o600)
            self.assertEqual(hashlib.sha256((target / 'run-reviewed.sh').read_bytes()).hexdigest(), result['runnerSha256'])
            self.assertEqual(hashlib.sha256((target / 'SHA256SUMS').read_bytes()).hexdigest(), result['checksumListSha256'])
            runner = (target / 'run-reviewed.sh').read_text()
            self.assertLess(runner.index('sha256sum -c SHA256SUMS'), runner.index('/usr/bin/python3'))
            self.assertIn(result['runnerSha256'], result['ownerCommand'])
            self.assertNotIn('restart', runner)
            self.assertNotIn('enable', runner)
            self.assertNotIn('rm ', runner)
            with patch.object(PACKAGE, 'READINESS_SHA256', hashlib.sha256(compiled.read_bytes()).hexdigest()):
                with self.assertRaises(FileExistsError):
                    PACKAGE.build_package(compiled, target)

    def test_refuses_forged_readiness_report_before_creating_any_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            compiled = Path(directory) / 'forged.cjs'
            compiled.write_text('process.stdout.write(JSON.stringify({status:"restricted-tls-ready"}));')
            target = Path(directory) / 'bundle'
            with self.assertRaisesRegex(ValueError, 'artifact checksum differs'):
                PACKAGE.build_package(compiled, target)
            self.assertFalse(target.exists())

    def test_packages_verified_bytes_when_compiled_path_is_replaced_after_first_read(self):
        with tempfile.TemporaryDirectory() as directory:
            compiled = Path(directory) / 'readiness.cjs'
            replacement = Path(directory) / 'replacement.cjs'
            reviewed = b'process.exit(0);\n'
            forged = b'process.stdout.write("forged readiness");\n'
            compiled.write_bytes(reviewed)
            replacement.write_bytes(forged)
            target = Path(directory) / 'bundle'
            read_bytes = Path.read_bytes

            def replace_after_read(path):
                content = read_bytes(path)
                if path == compiled and replacement.exists():
                    replacement.replace(compiled)
                return content

            expected = hashlib.sha256(reviewed).hexdigest()
            with patch.object(PACKAGE, 'READINESS_SHA256', expected), patch.object(Path, 'read_bytes', replace_after_read):
                PACKAGE.build_package(compiled, target)

            self.assertEqual(compiled.read_bytes(), forged)
            self.assertEqual((target / 'runtime-readiness-cli.cjs').read_bytes(), reviewed)
            manifest = json.loads((target / 'manifest.json').read_bytes())
            self.assertEqual(manifest['runtime-readiness-cli.cjs'], expected)
            self.assertIn(f'{expected}  runtime-readiness-cli.cjs\n', (target / 'SHA256SUMS').read_text())


if __name__ == '__main__':
    unittest.main()
