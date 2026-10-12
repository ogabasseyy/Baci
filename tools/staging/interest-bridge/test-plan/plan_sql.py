import json
from pathlib import Path


ROOT = Path(__file__).parent


def build_sql(mode, payload=None):
    if mode not in ('inventory', 'rehearse', 'apply', 'goal-rehearse', 'goal-apply'):
        raise ValueError('execution-mode')
    isolation = 'REPEATABLE READ' if mode == 'inventory' else 'READ COMMITTED'
    sql = f"BEGIN ISOLATION LEVEL {isolation};\nSET LOCAL statement_timeout='20s';\nSET LOCAL lock_timeout='3s';\n"
    sql += (ROOT / 'plan_snapshot.sql').read_text()
    if mode == 'inventory':
        return sql + '\nSET TRANSACTION READ ONLY;\nSELECT pg_temp.plan_inventory();\nROLLBACK;\n'
    if not isinstance(payload, dict):
        raise ValueError('execution-payload')
    if payload.get('goalOnly', False) is not mode.startswith('goal-'):
        raise ValueError('execution-policy-scope')
    literal = json.dumps(payload, sort_keys=True, separators=(',', ':')).replace("'", "''")
    sql += f"\nINSERT INTO pg_temp.test_plan_session VALUES ('{literal}'::jsonb);\n"
    sql += (ROOT / 'plan_treasury.sql').read_text()
    sql += (ROOT / 'plan_preconditions.sql').read_text()
    sql += (ROOT / 'plan_goal.sql').read_text()
    sql += (ROOT / 'plan_candidate.sql').read_text()
    sql += (ROOT / 'plan_binding_check.sql').read_text()
    sql += (ROOT / 'plan_binding.sql').read_text()
    sql += '\nCOMMIT;\n' if mode in ('apply', 'goal-apply') else '\nROLLBACK;\n'
    return sql
