import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('projection_fixture', ROOT / 'tools/test/prefunded-card-projection.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class TreasuryOwnerCandidate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = FIXTURE.PrefundedProjection
        cls.database.setUpClass()
        cls.database.sql(f"""
          CREATE ROLE prefunded_treasury_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
          GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator;
          INSERT INTO piggyvest_savings_ledger.bindings
            (integration_id,merchant_id,customer_id,goal_id,enabled,authorized_login)
          VALUES('{FIXTURE.INTEGRATION}','{FIXTURE.MERCHANT}','{FIXTURE.CUSTOMER}',
            '{FIXTURE.GOAL}',true,'prefunded_treasury_operator');
        """)

    @classmethod
    def tearDownClass(cls):
        cls.database.tearDownClass()

    def candidate(self, changes=None):
        value = dict(systemIdentifier=self.database.system, treasuryBindingId=FIXTURE.TREASURY,
                     integrationId=FIXTURE.INTEGRATION, merchantId=FIXTURE.MERCHANT,
                     businessId='business', sourceWalletId='business-treasury-only', openingAvailableKobo=10000,
                     verifiedAt=datetime.now(timezone.utc).isoformat(), expiresAt='2026-09-29T15:59:10Z',
                     verifierPassword='p' * 64)
        value.update(changes or {})
        folder = ROOT / 'tools/staging/prefunded-card'
        source = (folder / 'treasury-owner-candidate.sql').read_text()
        snapshot = (folder / 'treasury-snapshot-store.sql').read_text().strip()
        self.assertTrue(snapshot.startswith('BEGIN;') and snapshot.endswith('COMMIT;'))
        snapshot = snapshot[len('BEGIN;'):-len('COMMIT;')]
        source = source.replace('__OWNER_INPUT__', "'" + json.dumps(value).replace("'", "''") + "'")
        return source.replace('__SNAPSHOT_SQL__', snapshot)

    def apply(self, source):
        return subprocess.run([str(FIXTURE.BIN / 'psql'), '-XqAt', '-w', '-v', 'ON_ERROR_STOP=1',
                               '-h', str(self.database.path), '-p', '55461', '-U', 'harness_admin', '-d', 'postgres'],
                              input=source, text=True, capture_output=True, timeout=30,
                              env=self.database.environment)

    def test_guard_rejections_roll_back_roles_and_treasury(self):
        for values in [dict(systemIdentifier='1'), dict(openingAvailableKobo=10001),
                       dict(merchantId='11111111-1111-4111-8111-111111111119'),
                       dict(sourceWalletId='scratch-private-wallet'), dict(businessId='foreign'),
                       dict(verifiedAt='2026-09-20T00:00:00Z'), dict(verifierPassword='short'),
                       dict(expiresAt='2026-09-01T00:00:00Z')]:
            result = self.apply(self.candidate(values))
            self.assertNotEqual(result.returncode, 0, values)
            self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_bindings'), '0')
            self.assertEqual(self.database.sql("SELECT count(*) FROM pg_roles WHERE rolname='prefunded_snapshot_verifier'"), '0')
        source = self.candidate().replace('__NOT_PRESENT__', '')
        source = source.replace('COMMIT;', "DO $$ BEGIN RAISE EXCEPTION 'rollback rehearsal'; END $$; COMMIT;")
        result = self.apply(source)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('rollback rehearsal', result.stderr)
        self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_bindings'), '0')
        self.assertEqual(self.database.sql("SELECT to_regclass('prefunded_card.treasury_verifier_bindings') IS NULL"), 't')

    def test_customer_goal_and_mapping_must_agree_with_the_enabled_ledger_binding(self):
        foreign = '11111111-1111-4111-8111-111111111119'
        foreign_customer = '22222222-2222-4222-8222-222222222229'
        foreign_goal = '33333333-3333-4333-8333-333333333339'
        self.database.sql(f"""
          INSERT INTO public.merchants(id) VALUES('{foreign}');
          INSERT INTO public.customers(id,merchant_id) VALUES('{foreign_customer}','{FIXTURE.MERCHANT}');
          INSERT INTO public.customer_savings_goals
            (id,merchant_id,customer_id,goal_kind,source_mode,current_amount,target_amount,status)
          VALUES('{foreign_goal}','{FIXTURE.MERCHANT}','{FIXTURE.CUSTOMER}','legacy','manual',0,200,'active');
        """)
        cases = [
            ("public.customers", "merchant_id", f"'{foreign}'", f"'{FIXTURE.MERCHANT}'"),
            ("public.customer_savings_goals", "merchant_id", f"'{foreign}'", f"'{FIXTURE.MERCHANT}'"),
            ("piggyvest_staging.wallet_goal_mappings", "merchant_id", f"'{foreign}'", f"'{FIXTURE.MERCHANT}'"),
            ("piggyvest_staging.wallet_goal_mappings", "customer_id", f"'{foreign_customer}'", f"'{FIXTURE.CUSTOMER}'"),
            ("piggyvest_staging.wallet_goal_mappings", "goal_id", f"'{foreign_goal}'", f"'{FIXTURE.GOAL}'"),
            ("piggyvest_savings_ledger.bindings", "enabled", 'false', 'true'),
            ("public.customer_savings_goals", "status", "'cancelled'", "'active'"),
        ]
        for table, column, changed, original in cases:
            with self.subTest(table=table, column=column):
                self.database.sql(f'UPDATE {table} SET {column}={changed}')
                try:
                    result = self.apply(self.candidate())
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('treasury merchant mapping refused', result.stderr)
                    self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_bindings'), '0')
                    self.assertEqual(self.database.sql("SELECT count(*) FROM pg_roles WHERE rolname='prefunded_snapshot_verifier'"), '0')
                finally:
                    self.database.sql(f'UPDATE {table} SET {column}={original}')

    def test_existing_credit_route_refuses_before_any_provisioning(self):
        self.database.sql(f"""
          INSERT INTO prefunded_card.credit_routes VALUES('{FIXTURE.GOAL}','{FIXTURE.INTEGRATION}',
            '{FIXTURE.MERCHANT}','{FIXTURE.CUSTOMER}','{self.database.system}',clock_timestamp());
        """)
        try:
            result = self.apply(self.candidate())
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('existing credit routes refused', result.stderr)
            self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_bindings'), '0')
        finally:
            self.database.sql('ALTER TABLE prefunded_card.credit_routes DISABLE TRIGGER USER; '
                              'DELETE FROM prefunded_card.credit_routes; '
                              'ALTER TABLE prefunded_card.credit_routes ENABLE TRIGGER USER;')

    def test_install_without_registry_merchant_column_keeps_cards_disabled(self):
        self.assertEqual(self.database.sql("SELECT count(*) FROM information_schema.columns WHERE "
                                          "table_schema='piggyvest_staging' AND table_name='integrations' "
                                          "AND column_name='merchant_id'"), '0')
        result = self.apply(self.candidate())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_bindings'), '1')
        self.assertEqual(self.database.sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='prefunded_treasury_operator'"), 'f')
        self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.credit_routes'), '0')
        self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.operations'), '0')
        self.assertEqual(self.database.sql(f"SELECT prefunded_card.verify_snapshot_binding('{FIXTURE.TREASURY}',"
                                          f"'{self.database.system}','business','business-treasury-only')",
                                          'prefunded_snapshot_verifier'), 'verified')
        retry = self.apply(self.candidate())
        self.assertNotEqual(retry.returncode, 0)
        self.assertIn('already provisioned or partial', retry.stderr)
        self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_bindings'), '1')


if __name__ == '__main__':
    unittest.main()
