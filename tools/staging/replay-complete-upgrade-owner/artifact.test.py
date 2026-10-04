import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def fixture(contract):
    daemon = b'synthetic-reviewed-complete-daemon'
    production_bytes = b'synthetic-production-source'
    vendor_bytes = b'synthetic-vendor-source'
    sources = []
    captures = {}
    for name, content in (('/reviewed/daemon.ts', production_bytes), ('/reviewed/vendor.js', vendor_bytes)):
        pin = contract.sha(content)
        capture = 'captures/' + pin + '.source'
        captures[capture] = content
        sources.append(dict(path=name, sha256=pin, capture=capture))
    production = [{'path': sources[0]['path'], 'sha256': sources[0]['sha256']}]
    manifest = dict(version=1, source=dict(receiverRoot='/reviewed', savingsRoot='/unchanged',
                    entrypoints={}, inputs=dict(receiver=production, prefundedReplay=[])),
                    outputs={'replay-daemon.mjs': contract.sha(daemon),
                             'prefunded-replay-bundle.mjs': '0' * 64})
    manifest_bytes = contract.serialize(manifest)
    imports = [dict(path='node:crypto', kind='import-statement', external=True)]
    closure = dict(schemaVersion=1, scope='daemon-only', daemonSha256=contract.sha(daemon),
                   buildManifestSha256=contract.sha(manifest_bytes),
                   preservedFactorySha256=contract.PREDECESSOR_FILES['code/prefunded-replay-bundle.mjs'],
                   preservedPrivateConfigurationSha256=contract.PREDECESSOR_FILES['config/prefunded.json'],
                   generatedFactoryNotForInstallation=True, sources=sources, runtimeImports=imports)
    closure_bytes = contract.serialize(closure)
    files = {**captures, 'replay-daemon.mjs': daemon, 'replay-artifact.manifest.json': manifest_bytes,
             'daemon-closure.json': closure_bytes}
    pins = dict(COMPLETE_DAEMON_SHA256=contract.sha(daemon), PRODUCTION_INPUTS=1, DAEMON_INPUTS=2,
                RUNTIME_IMPORTS_SHA256=contract.digest(imports), DAEMON_ARTIFACT=dict(
                    closureSha256=contract.sha(closure_bytes), buildManifestSha256=contract.sha(manifest_bytes),
                    productionTableSha256=contract.digest(production), sourceTableSha256=contract.digest(sources)))
    return files, pins


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        specification = importlib.util.spec_from_file_location('complete_artifact_tests', HERE / 'artifact.py')
        self.module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.module)
        self.contract = self.module.contract
        self.files, self.pins = fixture(self.contract)

    def validate(self, files=None):
        with patch.multiple(self.contract, **self.pins):
            return self.module.validate_artifact(self.files if files is None else files)

    def repin(self, name, value):
        self.files[name] = self.contract.serialize(value)
        key = 'closureSha256' if name == 'daemon-closure.json' else 'buildManifestSha256'
        self.pins['DAEMON_ARTIFACT'][key] = self.contract.sha(self.files[name])

    def test_exact_daemon_closure_and_all_captures_accept_without_generated_factory(self):
        result = self.validate()
        self.assertEqual(result, self.pins['DAEMON_ARTIFACT'])
        result['closureSha256'] = '0' * 64
        self.assertNotEqual(result, self.pins['DAEMON_ARTIFACT'])

    def test_real_artifact_pins_have_no_public_override(self):
        self.assertEqual(self.contract.COMPLETE_DAEMON_SHA256,
                         '20a14582973e49d77f13140854107d386586364c8831a23e203b1967e7223126')
        self.assertEqual(self.contract.DAEMON_ARTIFACT['closureSha256'],
                         '380150f411cba2c96b57e1ef48607a7b71eafb60bb9def5bc48f80acceb3931b')
        with self.assertRaises(TypeError):
            self.module.validate_artifact(self.files, reviewed_daemon_sha256='0' * 64)

    def test_changed_daemon_manifest_or_closure_bytes_refuse(self):
        for name in self.module.FRAMING:
            with self.subTest(name=name):
                files = {**self.files, name: self.files[name] + b'changed'}
                with self.assertRaises(ValueError):
                    self.validate(files)

    def test_missing_or_changed_capture_refuses_even_when_production_is_unchanged(self):
        for name in set(self.files) - self.module.FRAMING:
            with self.subTest(name=name):
                files = {**self.files, name: b'changed-source'}
                with self.assertRaisesRegex(ValueError, 'artifact_capture_pin_refused'):
                    self.validate(files)
                del files[name]
                with self.assertRaisesRegex(ValueError, 'artifact_capture_pin_refused'):
                    self.validate(files)

    def test_generated_factory_or_unknown_payload_refuses_installation(self):
        for name in ('prefunded-replay-bundle.mjs', 'captures/../outside.source'):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, 'artifact_file_set_refused'):
                    self.validate({**self.files, name: b'old-generated-factory'})

    def test_source_table_changes_refuse_even_after_test_private_closure_repin(self):
        closure = self.contract.private_json(self.files['daemon-closure.json'])
        closure['sources'].pop()
        self.repin('daemon-closure.json', closure)
        with self.assertRaisesRegex(ValueError, 'artifact_source_table_refused'):
            self.validate()

    def test_production_table_changes_refuse_even_after_test_private_manifest_repin(self):
        manifest = self.contract.private_json(self.files['replay-artifact.manifest.json'])
        manifest['source']['inputs']['receiver'][0]['sha256'] = '0' * 64
        self.repin('replay-artifact.manifest.json', manifest)
        closure = self.contract.private_json(self.files['daemon-closure.json'])
        closure['buildManifestSha256'] = self.pins['DAEMON_ARTIFACT']['buildManifestSha256']
        self.repin('daemon-closure.json', closure)
        with self.assertRaisesRegex(ValueError, 'production_table_refused'):
            self.validate()

    def test_wrong_factory_private_scope_or_nonboolean_exclusion_refuses(self):
        original = self.contract.private_json(self.files['daemon-closure.json'])
        for name, value in (('preservedFactorySha256', '0' * 64),
                            ('preservedPrivateConfigurationSha256', '0' * 64),
                            ('generatedFactoryNotForInstallation', 1)):
            with self.subTest(name=name):
                closure = copy.deepcopy(original)
                closure[name] = value
                self.repin('daemon-closure.json', closure)
                with self.assertRaisesRegex(ValueError, 'artifact_scope_refused'):
                    self.validate()

    def test_changed_imports_refuse_without_accepting_arbitrary_runtime_dependency(self):
        closure = self.contract.private_json(self.files['daemon-closure.json'])
        closure['runtimeImports'][0]['path'] = 'unreviewed-package'
        self.repin('daemon-closure.json', closure)
        with self.assertRaisesRegex(ValueError, 'runtime_imports_refused'):
            self.validate()

    def test_partial_daemon_only_input_refuses_missing_manifest_and_closure(self):
        with self.assertRaisesRegex(ValueError, 'daemon_artifact_required'):
            self.validate({'replay-daemon.mjs': self.files['replay-daemon.mjs']})


if __name__ == '__main__':
    unittest.main()
