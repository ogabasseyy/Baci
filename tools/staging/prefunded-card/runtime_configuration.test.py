import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


DIRECTORY = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    'prefunded_card_runtime_configuration', DIRECTORY / 'runtime_configuration.py'
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('runtime configuration module unavailable')
RUNTIME_CONFIGURATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME_CONFIGURATION)

CA_PEM = '-----BEGIN CERTIFICATE-----\nU3ludGhldGljIENB\n-----END CERTIFICATE-----\n'
PIGGYVEST_SECRET = 'test_key_synthetic_piggyvest'
PAYSTACK_SECRET = 'sk_test_syntheticpaystack'
ROLE_PASSWORDS = {
    'prefunded_treasury_operator': 'T' * 64,
    'prefunded_evidence': 'E' * 64,
    'prefunded_authorizer': 'A' * 64,
}
CUSTOMER = '10000000-0000-4000-8000-000000000002'
PROJECT = 'baci-isolated-savings'


def load_template():
    return json.loads((DIRECTORY / 'activation-config.template.json').read_text())


def walk_values(value):
    if isinstance(value, dict):
        for nested in value.values():
            yield from walk_values(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from walk_values(nested)
    else:
        yield value


class RuntimeConfigurationTests(unittest.TestCase):
    def build(self, template=None, **overrides):
        arguments = {
            'template': load_template() if template is None else template,
            'certificate_authority_pem': CA_PEM,
            'piggyvest_secret': PIGGYVEST_SECRET,
            'paystack_secret': PAYSTACK_SECRET,
            'role_passwords': ROLE_PASSWORDS,
        }
        arguments.update(overrides)
        return RUNTIME_CONFIGURATION.build_runtime_configuration(**arguments)

    def test_fills_reviewed_template_recursively_without_mutating_original_or_emitting_secrets(self):
        template = load_template()
        original = copy.deepcopy(template)

        configuration = self.build(template)

        self.assertEqual(template, original)
        self.assertFalse(any(
            isinstance(value, str) and re.search(r'<[^<>]+>', value)
            for value in walk_values(configuration)
        ))
        self.assertEqual(configuration['expected']['systemIdentifier'], '7685292944002592802')
        self.assertEqual(configuration['expected']['expiresAt'], '2026-09-29T15:59:10Z')
        self.assertEqual(configuration['expected']['database'], 'postgres')
        self.assertEqual(configuration['expected']['projectId'], PROJECT)
        self.assertEqual(configuration['expected']['host'], 'piggyvest-db.staging.baci.internal')
        self.assertEqual(configuration['background']['worker']['merchantId'],
                         '10000000-0000-4000-8000-000000000001')
        self.assertEqual(configuration['background']['worker']['integrationId'],
                         'd91d9e87-8e0d-44de-9b84-1e1d709633d2')
        self.assertEqual(configuration['background']['worker']['treasuryBindingId'],
                         'ffffcb16-2e95-5cff-a591-e9cc81cf5f57')
        self.assertEqual(configuration['background']['worker']['businessId'],
                         '01M2381RG34HQJMHQKE7DWDACR')
        self.assertEqual(configuration['background']['provider']['scope']['sourceWalletId'],
                         '01M238A0V75387H4HZ15YFWGX3')
        self.assertEqual(
            configuration['expected']['certificateAuthoritySha256'],
            hashlib.sha256(CA_PEM.encode()).hexdigest(),
        )
        self.assertEqual(
            configuration['savedCardPublicRuntime']['context']['allowlistedCustomerIds'],
            [CUSTOMER],
        )
        self.assertEqual(
            configuration['publicCheckout']['maximumAmountKobo'], 10000
        )
        self.assertTrue(all(
            value == PIGGYVEST_SECRET
            for value in (
                configuration['background']['provider']['piggyvest']['apiSecret'],
                configuration['background']['evidence']['webhookSecret'],
                configuration['background']['evidence']['piggyvest']['apiSecret'],
                configuration['receiverReplayRuntime']['configuration']['evidence']['webhookSecret'],
                configuration['receiverReplayRuntime']['configuration']['evidence']['piggyvest']['apiSecret'],
            )
        ))
        paystack_values = (
            configuration['background']['provider']['paystackSecret'],
            configuration['publicCheckout']['checkout']['provider']['paystackSecret'],
            configuration['recovery']['provider']['paystackSecret'],
        )
        self.assertTrue(all(value == PAYSTACK_SECRET for value in paystack_values))
        self.assertTrue(all(value != PIGGYVEST_SECRET for value in paystack_values))
        database_configurations = (
            configuration['background']['database']['treasury'],
            configuration['background']['database']['ingestion'],
            configuration['background']['database']['authorizer'],
            configuration['publicCheckout']['checkout']['customerDatabase'],
            configuration['publicCheckout']['checkout']['verifierDatabase'],
            configuration['savedCardPublicRuntime']['database'],
            configuration['receiverReplayRuntime']['configuration']['database']['treasury'],
            configuration['receiverReplayRuntime']['configuration']['database']['ingestion'],
            configuration['recovery']['authorizerDatabase'],
        )
        self.assertTrue(all(
            database['host'] == database['expectedHost'] == 'piggyvest-db.staging.baci.internal'
            and database['database'] == database['expectedDatabase'] == 'postgres'
            and database['expectedProjectId'] == database['actualProjectId'] == PROJECT
            and database['certificateAuthority'] == CA_PEM
            for database in database_configurations
        ))
        self.assertTrue(all(
            value == ROLE_PASSWORDS['prefunded_treasury_operator']
            for value in (
                configuration['background']['database']['treasury']['password'],
                configuration['publicCheckout']['checkout']['customerDatabase']['password'],
                configuration['savedCardPublicRuntime']['database']['password'],
                configuration['receiverReplayRuntime']['configuration']['database']['treasury']['password'],
            )
        ))
        self.assertTrue(all(
            value == ROLE_PASSWORDS['prefunded_evidence']
            for value in (
                configuration['background']['database']['ingestion']['password'],
                configuration['receiverReplayRuntime']['configuration']['database']['ingestion']['password'],
            )
        ))
        self.assertTrue(all(
            value == ROLE_PASSWORDS['prefunded_authorizer']
            for value in (
                configuration['background']['database']['authorizer']['password'],
                configuration['publicCheckout']['checkout']['verifierDatabase']['password'],
                configuration['recovery']['authorizerDatabase']['password'],
            )
        ))

    def test_rejects_unknown_placeholder_without_echoing_inputs(self):
        template = load_template()
        template['expected']['database'] = '<UNREVIEWED-DATABASE>'

        with self.assertRaises(RUNTIME_CONFIGURATION.Refused) as error:
            self.build(template)

        self.assertNotIn(PIGGYVEST_SECRET, str(error.exception))
        self.assertNotIn(PAYSTACK_SECRET, str(error.exception))

    def test_rejects_non_object_template_and_incorrect_role_password_shape(self):
        for template, role_passwords in (
            ([], ROLE_PASSWORDS),
            (load_template(), {**ROLE_PASSWORDS, 'unexpected': 'X' * 64}),
            (load_template(), {'prefunded_treasury_operator': 'T' * 64}),
        ):
            with self.subTest(template_type=type(template).__name__, role_count=len(role_passwords)):
                with self.assertRaises(RUNTIME_CONFIGURATION.Refused):
                    self.build(template, role_passwords=role_passwords)

    def test_rejects_cyclic_template_input(self):
        template = {}
        template['cycle'] = template

        with self.assertRaises(RUNTIME_CONFIGURATION.Refused):
            self.build(template)

    def test_rejects_invalid_provider_secret_password_and_ca_inputs(self):
        for override in (
            {'piggyvest_secret': 'sk_test_wrong_provider'},
            {'paystack_secret': 'test_key_wrong_provider'},
            {'role_passwords': {**ROLE_PASSWORDS, 'prefunded_authorizer': 'bad'}},
            {'certificate_authority_pem': 'not a PEM certificate'},
        ):
            with self.subTest(input_name=next(iter(override))):
                with self.assertRaises(RUNTIME_CONFIGURATION.Refused):
                    self.build(**override)

    def test_generated_synthetic_configuration_passes_existing_typescript_validator(self):
        configuration = self.build()
        environment = os.environ.copy()
        environment['NODE_OPTIONS'] = '--conditions=react-server'

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as config_file:
            os.chmod(config_file.name, 0o600)
            json.dump(configuration, config_file)
            config_file.flush()
            result = subprocess.run(
                [
                    'pnpm', 'exec', 'tsx',
                    '../../tools/staging/prefunded-card/activation-config-preflight.ts',
                    config_file.name,
                ],
                cwd=DIRECTORY.parents[2] / 'apps' / 'web',
                env=environment,
                text=True,
                capture_output=True,
                check=False,
                timeout=60,
            )

        self.assertEqual(result.returncode, 0, 'existing TypeScript validator rejected synthetic config')
        self.assertIn('internally consistent', result.stdout)
        self.assertNotIn(PIGGYVEST_SECRET, result.stdout + result.stderr)
        self.assertNotIn(PAYSTACK_SECRET, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
