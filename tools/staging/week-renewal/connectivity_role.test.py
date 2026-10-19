import importlib.util
from pathlib import Path
import re
import unittest


SOURCE = Path(__file__).with_name('connectivity-role.sql')
HELPER = Path(__file__).with_name('connectivity_role.py')
SPEC = importlib.util.spec_from_file_location('connectivity_role_helper', HELPER)
connectivity_role = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(connectivity_role)


EVIDENCE = (
    ("begin_provisioning_verification", "p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text", "8eae0806000c5c5fad6d639af63078a3a48cd721b58ead26a8fc1b16445f2835"),
    ("claim_provisioning_intent", "p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_lease_seconds integer, p_expected_provider_account_id text, p_expected_provider_customer_id text", "e608c9254f23ea2e7b10b629a13ec4b31ecae93c65b0af924d2fd7a432478634"),
    ("confirm_provisioning_recovery", "p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text, p_verification_token uuid, p_wallet_id text, p_business_id text, p_currency text, p_wallet_status text", "3eb9f9a75e3c7d1598f60d811ff6ce09f0a89fabcc2fc9296e6f9991185e13be"),
    ("expire_provisioning_claim", "p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid", "45433cd6486175242105a933245ef6180b8ff35d575cb56261bddb09018eead3"),
    ("observe_provisioning_recovery", "p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text, p_wallet_id text, p_business_id text, p_currency text, p_wallet_status text", "6aa656147741efcd35af19b6d4611754524470998cdf5fc07297aa45c7c90753"),
    ("prepare_provisioning_intent", "p_integration_id uuid, p_expected_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_operation text, p_request_fingerprint bytea", "0b7aa3e95510436282fce9aa41d630795fa5a5c47b13aceb8d33b6d1703dff7a"),
    ("read_provisioning_recovery", "p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text", "7afab7115782b6da0ae0866b29f3d3aee4be7a4c65aa78ee43f5016fece7a5f9"),
    ("read_scoped_wallet_mapping", "p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid", "10915e25b30a6246c53d85c58605478f79a77c0afd888c9a2238089118647a8f"),
    ("record_created_customer", "p_integration_id uuid, p_merchant_id uuid, p_intent_id uuid, p_claim_token uuid, p_expected_business_id text, p_provider_customer_id text, p_provider_wallet_id text", "4291b55a7d0fc19dc7879fc25bb820e4997f765d0e90f9674843cc1c9b31872b"),
    ("record_provisioning_result", "p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_claim_token uuid, p_result_code text, p_provider_customer_id text, p_provider_wallet_id text", "8b1ab5c454b01d2ae1ea533fbb9c82ffffd1e450c534792190fd6d93213c228c"),
    ("resolve_wallet_mapping", "p_integration_id uuid, p_provider_wallet_id text, p_provider_customer_id text", "10176125b9f10c104f09ef01e58d2271efb01c9542f3ab35eed0466974b2ce4c"),
)


class ConnectivityRoleSourceTests(unittest.TestCase):
    def test_pins_exact_owner_evidence_signatures_and_definition_hashes(self):
        rows = re.findall(r"\('piggyvest_staging', '([a-z_]+)', '([^']+)', '([0-9a-f]{64})'\)", SOURCE.read_text())
        self.assertEqual(rows, list(EVIDENCE))

    def test_fragment_leaves_transaction_control_to_the_caller(self):
        source = SOURCE.read_text()
        self.assertNotRegex(source, r'(?im)^\s*(BEGIN|COMMIT|ROLLBACK)\s*;')
        self.assertIn("current_setting('transaction_read_only') <> 'off'", source)
        self.assertIn('inet_client_addr() IS NOT NULL', source)
        self.assertIn("system_identifier::text FROM pg_catalog.pg_control_system()) <> '7685292944002592802'", source)
        self.assertEqual(len(re.findall(r"^\s+\('piggyvest_staging', '[a-z_]+'", source, re.MULTILINE)), 11)
        self.assertIn('ALTER ROLE piggyvest_staging_provisioner VALID UNTIL', source)
        self.assertNotRegex(source, r'(?i)\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b')

    def test_renderer_accepts_only_exact_booleans_and_owns_transaction_ending(self):
        for value in (0, 1, 'true', None):
            with self.subTest(value=value), self.assertRaises(TypeError):
                connectivity_role.render_connectivity_role_script(value)
        rollback = connectivity_role.render_connectivity_role_script(False)
        commit = connectivity_role.render_connectivity_role_script(True)
        self.assertTrue(rollback.startswith("BEGIN;\nSET LOCAL statement_timeout = '10s';\n"))
        self.assertIn("SET LOCAL lock_timeout = '3s';\nSET LOCAL search_path = pg_catalog;", rollback)
        self.assertTrue(rollback.endswith('ROLLBACK;\n'))
        self.assertTrue(commit.endswith('COMMIT;\n'))
        self.assertEqual(rollback.count(SOURCE.read_text().rstrip()), 1)
        self.assertEqual(commit.count(SOURCE.read_text().rstrip()), 1)


if __name__ == '__main__':
    unittest.main()
