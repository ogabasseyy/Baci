import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPT = Path(__file__).with_name('activation-owner-diagnostic.py')
SPEC = importlib.util.spec_from_file_location('activation_owner_diagnostic', SCRIPT)
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)


class ActivationOwnerDiagnosticTests(unittest.TestCase):
    def test_rejects_an_unrelated_database_before_metadata_query(self):
        calls = []

        def run(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return SimpleNamespace(returncode=0, stdout='999\n', stderr='')

        with self.assertRaisesRegex(diagnostic.Refused, 'system identifier'):
            diagnostic.database_metadata(run)

        self.assertEqual(len(calls), 1)
        self.assertIn('BEGIN TRANSACTION READ ONLY', calls[0][1]['input'])
        self.assertIn('ROLLBACK', calls[0][1]['input'])
        self.assertNotIn('pg_proc', calls[0][1]['input'])

    def test_reports_allowlisted_metadata_without_provider_or_config_values(self):
        calls = []

        def run(arguments, **kwargs):
            calls.append((arguments, kwargs))
            if len(calls) == 1:
                return SimpleNamespace(
                    returncode=0,
                    stdout='7685292944002592802\n',
                    stderr='',
                )
            return SimpleNamespace(
                returncode=0,
                stdout='\n'.join(
                    [
                        'system_identifier|7685292944002592802',
                        'schema|true',
                        'function|checkout_reserve|jsonb,jsonb',
                        'function|checkout_read|jsonb,jsonb',
                        'function|checkout_claim_initialization|jsonb,jsonb',
                        'function|checkout_complete_initialization|jsonb,jsonb,jsonb,jsonb',
                        'function|checkout_mark_initialization_uncertain|jsonb,jsonb,jsonb',
                        'function|checkout_promote_collection|jsonb,jsonb,jsonb',
                        'function|checkout_flag_reconciliation|jsonb,jsonb',
                        'function|checkout_capability|jsonb,uuid,uuid,uuid,bigint',
                        'role|prefunded_treasury_ledger_worker|false',
                        'role|prefunded_card_authorization_reader|false',
                        'role|prefunded_card_authorization_provisioner|false',
                        'role|prefunded_treasury_operator|true',
                        'role|prefunded_authorizer|true',
                        'role|prefunded_evidence|true',
                        'membership|prefunded_treasury_ledger_worker|prefunded_treasury_operator',
                        'membership|prefunded_card_authorization_reader|prefunded_treasury_operator',
                        'membership|prefunded_card_authorization_provisioner|prefunded_authorizer',
                    ]
                ),
                stderr='provider_secret=never-output',
            )

        result = diagnostic.database_metadata(run)

        self.assertEqual(result['systemIdentifier'], '7685292944002592802')
        self.assertTrue(result['prefundedSchemaPresent'])
        self.assertEqual(len(result['checkoutFunctions']), 8)
        self.assertTrue(result['checkoutCapabilityPresent'])
        self.assertEqual(result['checkoutFunctionBaseline'], 'eight_function_ready')
        self.assertEqual(len(result['executorRoles']), 6)
        self.assertEqual(len(result['memberships']), 3)
        self.assertNotIn('provider_secret', json.dumps(result))
        self.assertEqual(calls[0][0][:4], ['/usr/bin/docker', 'exec', '-i', diagnostic.CONTAINER])
        self.assertEqual(calls[0][1]['env'], diagnostic.CLEARED_ENV)
        self.assertEqual(calls[0][1]['timeout'], 20)

    def test_uses_argument_type_vectors_when_catalog_functions_have_named_parameters(self):
        query = diagnostic._metadata_sql()

        self.assertIn('pg_catalog.oidvectortypes(p.proargtypes)', query)
        self.assertNotIn('pg_get_function_identity_arguments', query)

    def test_metadata_transaction_rechecks_the_system_identifier_before_relations(self):
        query = diagnostic._metadata_sql()

        self.assertIn("SELECT 'system_identifier|' || system_identifier FROM scope", query)
        self.assertIn("WHERE scope.system_identifier = '7685292944002592802'", query)

    def test_metadata_invocation_is_read_only_and_does_not_mutate_systemd(self):
        source = Path(diagnostic.__file__).read_text()
        self.assertNotRegex(source, r'\b(start|restart|enable|stop|daemon-reload)\b')
        self.assertNotRegex(source, r'\b(insert|update|delete|alter|create|drop)\b')


if __name__ == '__main__':
    unittest.main()
