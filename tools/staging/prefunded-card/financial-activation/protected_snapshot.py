from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'card-week-renewal'))
from database_sql import _protected_state_expression
from source_functions import APP_SYSTEM, _require

TABLES = (
    'prefunded_card.checkout_intents', 'prefunded_card.operations',
    'prefunded_card.checkout_retirements', 'prefunded_card.treasury_bindings',
    'prefunded_card.treasury_identities', 'prefunded_card.treasury_replenishments',
    'prefunded_card.credit_routes', 'prefunded_card.provider_evidence',
    'prefunded_card.inflow_attributions', 'prefunded_card.evidence_conflicts',
    'prefunded_card.projections', 'prefunded_card.bank_projections',
    'piggyvest_savings_ledger.bindings', 'piggyvest_savings_ledger.operations',
    'piggyvest_savings_ledger.postings', 'piggyvest_staging.wallet_goal_mappings',
    'piggyvest_staging.goal_inflow_projections',
    'public.customer_savings_contributions', 'public.piggyvest_inflow_credits',
    'public.customers', 'piggyvest_staging.integrations',
)


def protected_expression():
    expressions = []
    for table in TABLES:
        expressions.append(f"""'{table}', (SELECT jsonb_build_object('count',count(*),
          'sha256',encode(sha256(convert_to(coalesce(string_agg(
            to_jsonb(protected_row)::text,E'\\n' ORDER BY to_jsonb(protected_row)::text),''),'UTF8')),'hex'))
          FROM {table} protected_row)""")
    return f"jsonb_build_object('financial',({_protected_state_expression()}),'tables',jsonb_build_object({','.join(expressions)}))"


def snapshot_sql():
    expression = protected_expression()
    return (f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path=pg_catalog;
DO $identity$ BEGIN
  IF session_user<>'postgres' OR current_database()<>'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'{APP_SYSTEM}' THEN
    RAISE EXCEPTION 'financial snapshot identity refused' USING ERRCODE='42501'; END IF;
END $identity$;
SELECT jsonb_build_object('systemIdentifier','{APP_SYSTEM}',
  'readOnly',current_setting('transaction_read_only')='on',
  'protectedFinancialSha256',encode(sha256(convert_to(({_protected_state_expression()})::text,'UTF8')),'hex'),
  'tables',({expression})->'tables');
ROLLBACK;
""").encode()


def prove_unchanged(before, after):
    for value in (before, after):
        _require(isinstance(value, dict) and set(value) == {
            'systemIdentifier', 'readOnly', 'protectedFinancialSha256', 'tables'}
            and value['systemIdentifier'] == APP_SYSTEM and value['readOnly'] is True,
            'independent_protected_snapshot_missing')
        from release_contract import HEX
        _require(isinstance(value['protectedFinancialSha256'], str)
                 and HEX.fullmatch(value['protectedFinancialSha256'])
                 and isinstance(value['tables'], dict) and set(value['tables']) == set(TABLES),
                 'independent_protected_snapshot_incomplete')
        for row in value['tables'].values():
            _require(isinstance(row, dict) and set(row) == {'count', 'sha256'}
                     and type(row['count']) is int and row['count'] >= 0
                     and isinstance(row['sha256'], str) and HEX.fullmatch(row['sha256']),
                     'independent_protected_snapshot_incomplete')
    _require(before == after, 'independent_full_protected_snapshot_changed')
