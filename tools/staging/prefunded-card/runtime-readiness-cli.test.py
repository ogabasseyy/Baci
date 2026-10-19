import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from runtime_configuration import build_runtime_configuration
from treasury_owner_contract import DEADLINE_EPOCH


DIRECTORY = Path(__file__).parent
WEB = DIRECTORY.parents[2] / 'apps/web'
SPEC = importlib.util.spec_from_file_location('runtime_package', DIRECTORY / 'runtime-preparation-package.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class RuntimeReadinessCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='baci-readiness-cli.')
        cls.root = Path(cls.scratch.name)
        cls.compiled = cls.root / 'readiness.cjs'
        result = subprocess.run([
            'pnpm', 'exec', 'esbuild', '../../tools/staging/prefunded-card/runtime-readiness-cli.ts',
            '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--conditions=react-server',
            '--external:pg-native', '--outfile=' + str(cls.compiled),
        ], cwd=WEB, text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError('Readiness CLI test build failed')

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def invoke(self, *arguments):
        return subprocess.run(['node', str(self.compiled), *arguments], text=True, capture_output=True, timeout=10,
                              env={key: value for key, value in os.environ.items() if not key.startswith(('NODE_', 'PG'))})

    def test_compiled_artifact_matches_reviewed_digest(self):
        self.assertEqual(hashlib.sha256(self.compiled.read_bytes()).hexdigest(), PACKAGE.READINESS_SHA256)

    def test_check_accepts_only_private_consistent_config_without_database_contact(self):
        config = build_runtime_configuration(
            json.loads((DIRECTORY / 'activation-config.template.json').read_bytes()),
            '-----BEGIN CERTIFICATE-----\nU3ludGhldGljIENB\n-----END CERTIFICATE-----\n',
            'test_key_synthetic', 'sk_test_synthetic',
            {'prefunded_treasury_operator': 'a' * 64, 'prefunded_authorizer': 'b' * 64,
             'prefunded_evidence': 'c' * 64})
        path = self.root / 'private.json'
        path.write_text(json.dumps(config))
        path.chmod(0o600)
        result = self.invoke('--check', str(path))
        if time.time() < DEADLINE_EPOCH:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), dict(status='configuration-checked', databaseContacted=False,
                                                            cardPaymentsEnabled=False))
        else:
            self.assertEqual(result.returncode, 1)
        path.chmod(0o644)
        refused = self.invoke('--check', str(path))
        self.assertEqual(refused.returncode, 1)
        self.assertNotIn('synthetic', refused.stdout + refused.stderr)

    def test_invalid_args_and_malformed_config_are_redacted_and_refused(self):
        path = self.root / 'malformed.json'
        path.write_text('{password=private-test-canary}')
        path.chmod(0o600)
        for arguments in (('--other', str(path)), ('--check', str(path)), ('--check', str(path), 'extra')):
            with self.subTest(arguments=arguments):
                result = self.invoke(*arguments)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(result.stdout), dict(status='refused', redacted=True, cardPaymentsEnabled=False))
                self.assertNotIn('private-test-canary', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
