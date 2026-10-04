import importlib.util
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
LEGACY_SPEC = importlib.util.spec_from_file_location(
    'legacy_enrollment_local', ROOT / 'tools/staging/prefunded-card/legacy-enrollment-local.test.py'
)
LEGACY = importlib.util.module_from_spec(LEGACY_SPEC)
LEGACY_SPEC.loader.exec_module(LEGACY)

ROUTE = ROOT / 'tools/staging/prefunded-card/enrollment-owner-candidate.sql'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
SOURCE = '01M238A0V75387H4HZ15YFWGX3'


class EnrollmentOwnerCandidate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.legacy = LEGACY.LegacyEnrollment
        cls.legacy.setUpClass()
        cls.database = cls.legacy.database
        cls.base = cls.legacy()
        cls.base.run_candidate(cls.base.proof())
        cls.file('replay-enrollment.sql')
        cls.sql(f"""
          INSERT INTO prefunded_card.treasury_bindings(
            id,integration_id,merchant_id,expected_business_id,source_wallet_id,currency,
            verified_available_kobo,reserved_kobo,consumed_kobo,verified_at,authorized_login,enabled
          ) VALUES(
            '{TREASURY}','{LEGACY.INTEGRATION}','{LEGACY.MERCHANT}','business','{SOURCE}','NGN',
            10000,0,0,clock_timestamp(),'prefunded_treasury_operator',true
          );
          INSERT INTO prefunded_card.treasury_identities(
            treasury_binding_id,integration_id,merchant_id,expected_business_id,source_wallet_id,
            authorized_login,opening_available_kobo,provisioned_by
          ) VALUES(
            '{TREASURY}','{LEGACY.INTEGRATION}','{LEGACY.MERCHANT}','business','{SOURCE}',
            'prefunded_treasury_operator',10000,session_user
          );
        """)

    @classmethod
    def tearDownClass(cls):
        try:
            for suffix in ('success', 'scope', 'inflow', 'projection', 'rollback', 'authority', 'stale', 'resolver', 'metadata'):
                cls.database.sql(f'DROP DATABASE IF EXISTS piggyvest_legacy_enrollment_scratch_owner_{suffix}')
        finally:
            cls.legacy.tearDownClass()

    @classmethod
    def sql(cls, query, database='piggyvest_legacy_enrollment_scratch'):
        return cls.legacy.sql(query, database)

    @classmethod
    def file(cls, filename, database='piggyvest_legacy_enrollment_scratch'):
        cls.legacy.file(filename, database)

    @classmethod
    def clone(cls, suffix):
        database = f'piggyvest_legacy_enrollment_scratch_owner_{suffix}'
        cls.database.sql(f'CREATE DATABASE {database} TEMPLATE piggyvest_legacy_enrollment_scratch')
        return database

    def run_candidate(self, database='piggyvest_legacy_enrollment_scratch', fail_after_route=False, check=True):
        return self.legacy.psql(
            database,
            '-v', 'enrollment_owner_test=on',
            '-v', f'enrollment_owner_system={self.database.system}',
            '-v', f'enrollment_owner_fail_after_route={"on" if fail_after_route else "off"}',
            '-v', f'enrollment_owner_integration={LEGACY.INTEGRATION}',
            '-v', 'enrollment_owner_business=business',
            '-v', f'enrollment_owner_merchant={LEGACY.MERCHANT}',
            '-v', f'enrollment_owner_customer={LEGACY.CUSTOMER}',
            '-v', f'enrollment_owner_goal={LEGACY.GOAL}',
            '-v', 'enrollment_owner_wallet=scratch-private-wallet',
            '-v', 'enrollment_owner_provider_customer=scratch-event-customer',
            '-f', ROUTE,
            check=check,
        )

    def assert_refused_without_route(self, database, expected):
        failed = self.run_candidate(database, check=False)
        self.assertNotEqual(failed.returncode, 0, failed.stdout)
        self.assertIn(expected, failed.stderr)
        self.assertEqual(self.sql(f"SELECT count(*) FROM prefunded_card.credit_routes WHERE goal_id='{LEGACY.GOAL}'", database), '0')

    def test_enrolls_once_and_revalidates_identical_retry(self):
        database = self.clone('success')
        self.assertEqual(self.run_candidate(database).stdout.strip().splitlines()[-1], 'enrolled')
        self.assertEqual(self.sql(f"""
          SELECT count(*) FROM prefunded_card.credit_routes
          WHERE goal_id='{LEGACY.GOAL}' AND integration_id='{LEGACY.INTEGRATION}'
            AND merchant_id='{LEGACY.MERCHANT}' AND customer_id='{LEGACY.CUSTOMER}'
            AND system_identifier='{self.database.system}'
        """, database), '1')
        self.assertEqual(self.run_candidate(database).stdout.strip().splitlines()[-1], 'already_enrolled')

    def test_refuses_scope_mismatch_without_creating_a_route(self):
        database = self.clone('scope')
        self.sql("SET session_replication_role=replica; "
                 "UPDATE prefunded_card.treasury_bindings "
                 "SET merchant_id='99999999-9999-4999-8999-999999999999' "
                 f"WHERE id='{TREASURY}'; SET session_replication_role=origin", database)
        self.assert_refused_without_route(database, 'legacy route treasury scope refused')

    def test_refuses_intervening_public_contribution_as_history_reconciliation(self):
        database = self.clone('inflow')
        self.sql(f"""
          INSERT INTO public.customer_savings_contributions(
            id,goal_id,merchant_id,customer_id,amount,source_type,status,idempotency_key
          ) VALUES(
            '55555555-5555-4555-8555-555555555555','{LEGACY.GOAL}','{LEGACY.MERCHANT}',
            '{LEGACY.CUSTOMER}',1,'piggyvest_inflow','completed','piggyvest:unmatched-intervening'
          )
        """, database)
        self.assert_refused_without_route(database, 'needs-history-reconciliation')

    def test_refuses_equal_total_when_bank_projection_set_is_wrong(self):
        database = self.clone('projection')
        self.sql("SET session_replication_role=replica; "
                 "UPDATE prefunded_card.bank_projections SET event_id='wrong-event' "
                 f"WHERE goal_id='{LEGACY.GOAL}'; SET session_replication_role=origin", database)
        self.assert_refused_without_route(database, 'legacy canonical projection set refused')

    def test_rolls_back_route_when_late_postflight_fails(self):
        database = self.clone('rollback')
        failed = self.run_candidate(database, fail_after_route=True, check=False)
        self.assertNotEqual(failed.returncode, 0, failed.stdout)
        self.assertIn('legacy route rehearsal rollback', failed.stderr)
        self.assertEqual(self.sql(f"SELECT count(*) FROM prefunded_card.credit_routes WHERE goal_id='{LEGACY.GOAL}'", database), '0')

    def test_refuses_disabled_replay_authority_before_irreversible_cutover(self):
        database = self.clone('authority')
        self.sql('SET session_replication_role=replica; UPDATE prefunded_card.evidence_authorities '
                 'SET enabled=false; SET session_replication_role=origin', database)
        self.assert_refused_without_route(database, 'legacy route evidence authority refused')

    def test_refuses_old_alias_function_even_when_all_migrated_totals_match(self):
        database = self.clone('stale')
        updated = ROUTE.with_name('evidence-legacy.sql').read_text()
        start = updated.index("  IF receipt.observation->>'providerTransactionId' IS DISTINCT FROM p_provider_transaction_id THEN")
        end = updated.index("  IF receipt.observation->>'kind'<>'bank_inflow'", start)
        old = updated[:start] + "  IF receipt.observation->>'providerTransactionId' IS DISTINCT FROM p_provider_transaction_id THEN RETURN 'reconciliation_required'; END IF;\n" + updated[end:]
        self.sql(old.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1), database)
        self.assert_refused_without_route(database, 'legacy route function baseline refused')

    def test_refuses_missing_replay_resolver(self):
        database = self.clone('resolver')
        self.sql('DROP FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)', database)
        self.assert_refused_without_route(database, 'legacy route function baseline refused')

    def test_refuses_function_security_drift_with_unchanged_body(self):
        database = self.clone('metadata')
        self.sql('ALTER FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb) '
                 'SECURITY INVOKER', database)
        self.assert_refused_without_route(database, 'legacy route function baseline refused')

    def test_locks_all_reconciled_state_before_totals_and_route_insert(self):
        text = ROUTE.read_text()
        first_total = text.index('coalesce(sum(')
        self.assertIn('pg_advisory_xact_lock', text)
        self.assertIn('LOCK TABLE', text)
        self.assertLess(text.index('FOR UPDATE', 0, first_total), first_total)
        self.assertLess(text.index('FOR SHARE', 0, first_total), first_total)
        self.assertLess(first_total, text.index('INSERT INTO prefunded_card.credit_routes'))
        self.assertNotIn('GRANT ', text)
        self.assertNotIn('CREATE ROLE', text)
        self.assertNotIn('CREATE FUNCTION', text)


if __name__ == '__main__':
    unittest.main()
