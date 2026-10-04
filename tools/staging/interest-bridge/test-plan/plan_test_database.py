import json
import os
from pathlib import Path
import subprocess
import tempfile

from plan_constants import SCOPE
from plan_contract import validate_approval
from plan_sql import build_sql
from plan_test_fixture import plan_test_fixture
from datetime import datetime, timezone


BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ROOT = Path(__file__).parent
MIGRATIONS = ROOT.parents[3] / 'supabase/migrations'


class PlanTestDatabase:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix='baci-empty-plan.')
        self.root = Path(self.directory.name)
        self.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        try:
            self.command([BIN / 'initdb', '-D', self.root / 'data', '-A', 'trust', '-U', 'postgres',
                          '--no-locale', '--wal-segsize=1'])
            self.command([BIN / 'pg_ctl', '-D', self.root / 'data', '-l', self.root / 'server.log',
                          '-o', f"-k {self.root} -h '' -p 55483 -c shared_buffers=4MB", 'start'])
            self.bootstrap()
        except Exception:
            self.close()
            raise

    def command(self, arguments, **kwargs):
        return subprocess.run([str(value) for value in arguments], env=self.environment,
                              text=True, capture_output=True, check=True, timeout=40, **kwargs)

    def query(self, sql):
        return self.command([BIN / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', self.root,
                             '-p', '55483', '-U', 'postgres', '-d', 'postgres'], input=sql).stdout.strip()

    def close(self):
        subprocess.run([str(BIN / 'pg_ctl'), '-D', str(self.root / 'data'), '-m', 'immediate', 'stop'],
                       capture_output=True, timeout=20)
        self.directory.cleanup()

    def reset(self):
        return self.command([BIN / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', self.root,
            '-p', '55483', '-U', 'postgres', '-d', 'template1'], input="""
              DROP DATABASE postgres WITH (FORCE);
              CREATE DATABASE postgres TEMPLATE empty_plan_fixture;
            """).stdout.strip()

    def bootstrap(self):
        self.query((ROOT / 'plan_test_database.sql').read_text())
        self.query((MIGRATIONS / '20260521130000_customer_wallet_dva_and_device_savings_tables.sql').read_text())
        self.query((MIGRATIONS / '20260608063606_fix_savings_goal_autodebit_wallet_balance.sql').read_text())
        current_rpc = Path('/Users/mac/.codex/worktrees/0d77/Baci-app/supabase/migrations') / '20260923150000_customer_savings_goal_idempotency.sql'
        self.query(current_rpc.read_text())
        settings = (MIGRATIONS / '20260525000000_customer_savings_authorization_confirmation_rpcs.sql').read_text()
        settings = 'CREATE OR REPLACE FUNCTION public.get_customer_savings_feature_settings(' + settings.split(
            'CREATE OR REPLACE FUNCTION public.get_customer_savings_feature_settings(', 1)[1].split(
            'CREATE OR REPLACE FUNCTION public.get_customer_wallet_dva_enabled(', 1)[0]
        self.query(settings)
        self.query((ROOT / 'plan_test_seed.sql').read_text())
        variant_guard = (MIGRATIONS / '20260911211000_close_savings_variant_and_redemption_gaps.sql').read_text().split(
            'CREATE OR REPLACE FUNCTION public.resolve_completed_customer_savings_goal_variant(', 1)[0]
        self.query(variant_guard)
        finite_guard = (MIGRATIONS / '20260911211100_require_finite_customer_savings_money.sql').read_text()
        self.query(finite_guard)
        self.query((MIGRATIONS / '20260912090200_piggyvest_staging_wallet_goal_mappings.sql').read_text())
        self.query((MIGRATIONS / '20260912120000_piggyvest_savings_ledger_tables.sql').read_text())
        self.query((MIGRATIONS / '20260912120100_piggyvest_savings_ledger_guards.sql').read_text())
        policy = (MIGRATIONS / '20261001230000_customer_savings_interest_policy.sql').read_text().split(
            'CREATE OR REPLACE FUNCTION piggyvest_savings_ledger.prepare_interest_allocation(', 1)[0]
        self.query(policy + '\nCOMMIT;')
        self.query("""
          CREATE FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
            RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic-unused-bridge'::text $$;
          CREATE FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
          CREATE FUNCTION piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)
            RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
          REVOKE ALL ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb),
            piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
          REVOKE ALL ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text) FROM PUBLIC;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
            TO prefunded_treasury_operator;
          INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
            ('d91d9e87-8e0d-44de-9b84-1e1d709633d2','01M3CQX27G9687EFSF1TKYMPR9',
            'c096507d-dc32-45d2-9c01-871a27abfd10','10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002','430314fd-cd8b-4579-98d4-e9f345713dd6');
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('430314fd-cd8b-4579-98d4-e9f345713dd6','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
            '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
            'prefunded_treasury_operator',true);
        """)
        guard = (MIGRATIONS / '20260913140000_customer_savings_canonical_isolation.sql').read_text()
        guard = 'CREATE FUNCTION savings_draft_private.guard_canonical_goal()' + guard.split(
            'CREATE FUNCTION savings_draft_private.guard_canonical_goal()', 1)[1].split(
            'CREATE FUNCTION savings_draft_private.reject_canonical_activity()', 1)[0]
        self.query(guard)
        self.query('CREATE DATABASE empty_plan_fixture TEMPLATE postgres')

    def inventory(self):
        return json.loads(self.query(build_sql('inventory')))

    def payload(self, goal_only=False):
        approval, _, wallet = plan_test_fixture()
        if goal_only:
            approval['routing'] = None
        snapshot = self.inventory()
        approval.update({key: snapshot[key] for key in ('schemaMd5', 'stateMd5')})
        approval['snapshotObservedAt'] = snapshot['observedAt']
        snapshot['systemIdentifier'] = SCOPE['systemIdentifier']
        payload = validate_approval(approval, snapshot, wallet, datetime.now(timezone.utc), goal_only=goal_only)
        payload['systemIdentifier'] = self.query('SELECT system_identifier::text FROM pg_control_system()')
        return payload
