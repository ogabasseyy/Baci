import importlib.util
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / 'tools/staging/interest-bridge'
spec = importlib.util.spec_from_file_location('interest_harness', Path(__file__).with_name('piggyvest-interest-bridge.test.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
spec = importlib.util.spec_from_file_location('policy_installer', DIRECTORY / 'install-policy.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InterestPolicyInstallation(bridge.InterestDatabase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sql_file(ROOT / 'supabase/migrations/20261001140000_piggyvest_interest_existing_authority.sql')
        cls.sql(f"""
          CREATE ROLE postgres SUPERUSER;
          CREATE ROLE supabase_admin SUPERUSER LOGIN;
          CREATE ROLE prefunded_treasury_operator LOGIN;
          ALTER FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text) OWNER TO postgres;
          ALTER TABLE public.customer_savings_goals ADD COLUMN status text DEFAULT 'active',
            ADD COLUMN current_amount numeric DEFAULT 100;
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('{bridge.GOAL}','{bridge.INTEGRATION}','{bridge.MERCHANT}','{bridge.CUSTOMER}',
             'prefunded_treasury_operator',true);
          CREATE SCHEMA prefunded_card;
          CREATE TABLE prefunded_card.treasury_bindings
            (id uuid,enabled boolean,verified_available_kobo bigint,reserved_kobo bigint,consumed_kobo bigint);
          CREATE TABLE prefunded_card.checkout_intents (id uuid,phase text);
          CREATE TABLE prefunded_card.operations
            (id uuid,checkout_retired boolean,collection_status text,transfer_status text,projection_status text);
          INSERT INTO prefunded_card.treasury_bindings VALUES
            ('ffffcb16-2e95-5cff-a591-e9cc81cf5f57',true,10000,0,0);
          INSERT INTO prefunded_card.checkout_intents VALUES
            ('d8bcf921-61b3-4647-90e2-5648e4d6967d','retired_unconfirmed');
          INSERT INTO prefunded_card.operations VALUES
            ('d8bcf921-61b3-4647-90e2-5648e4d6967d',true,'pending','not_started','unapplied');
        """)

    def test_rehearsal_rolls_back_then_commit_changes_only_policy_functions_and_read_rpc(self):
        guard = (DIRECTORY / 'policy-guard.sql').read_text()
        migration = (ROOT / 'supabase/migrations' / installer.MIGRATION_NAME).read_bytes()
        substitutions = {
            '7685292944002592802': self.system_id,
            'd91d9e87-8e0d-44de-9b84-1e1d709633d2': bridge.INTEGRATION,
            '01M2381RG34HQJMHQKE7DWDACR': 'synthetic-account',
            '10000000-0000-4000-8000-000000000002': bridge.CUSTOMER,
            '430314fd-cd8b-4579-98d4-e9f345713dd6': bridge.GOAL,
        }
        def candidate(apply=False):
            source = installer.render_sql(migration, guard, apply)
            for original, synthetic in substitutions.items():
                source = source.replace(original, synthetic)
            return source
        self.sql(candidate(), 'supabase_admin')
        self.assertEqual(self.sql("SELECT to_regclass('piggyvest_savings_ledger.interest_policies') IS NULL").strip(), 't')
        self.sql("UPDATE public.customer_savings_goals SET current_amount=99")
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(candidate(True), 'supabase_admin')
        self.assertEqual(self.sql("SELECT to_regclass('piggyvest_savings_ledger.interest_policies') IS NULL").strip(), 't')
        self.sql("UPDATE public.customer_savings_goals SET current_amount=100")
        self.sql(candidate(True), 'supabase_admin')
        self.assertEqual(self.sql("SELECT count(*) FROM piggyvest_savings_ledger.interest_policies").strip(), '0')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator',"
            "'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE')").strip(), 'f')
        self.assertEqual(self.sql("SELECT current_amount FROM public.customer_savings_goals").strip(), '100')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(candidate(True), 'supabase_admin')


if __name__ == '__main__':
    unittest.main()
