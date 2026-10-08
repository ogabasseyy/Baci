"""Read-only wallet grants and customer-scoped RLS checks in isolated Postgres."""

import subprocess


CONTAINER = 'baci-isolated-savings-db-1'
REQUIRED_COLUMNS = {
    'customer_wallets': ('id', 'available_balance', 'total_earned', 'total_redeemed', 'customer_id', 'merchant_id'),
    'customer_wallet_transactions': ('id', 'type', 'amount', 'balance_after', 'description', 'created_at', 'source_type', 'wallet_id'),
    'customer_wallet_payment_accounts': ('account_name', 'account_number', 'bank_name', 'provider', 'status', 'customer_id', 'merchant_id'),
    'customer_wallet_accounts': ('available_balance', 'currency', 'customer_id', 'merchant_id'),
}
SUPPORTING_COLUMNS = {
    'merchants': ('id', 'slug'),
    'customers': ('id', 'loyalty_points', 'merchant_id', 'user_id', 'email'),
}


class Refused(RuntimeError):
    pass


def _sql():
    grant_values = [
        f"('{table}','{column}')"
        for table, columns in (SUPPORTING_COLUMNS | REQUIRED_COLUMNS).items()
        for column in columns
    ]
    wallet_tables = ','.join(f"('{table}')" for table in REQUIRED_COLUMNS)
    return f"""
BEGIN TRANSACTION READ ONLY;
WITH required(table_name,column_name) AS (VALUES {','.join(grant_values)}),
wallet_tables(table_name) AS (VALUES {wallet_tables}),
grants AS (
 SELECT table_name || '.' || column_name AS key,
        has_column_privilege('authenticated','public.' || table_name,column_name,'SELECT') AS allowed
 FROM required
),
policies AS (
 SELECT w.table_name, c.relrowsecurity AS rls_enabled,
        COALESCE(bool_or(
          p.polcmd IN ('r','*') AND
          (p.polroles @> ARRAY[0::oid] OR
           p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]) AND
          position('auth.uid' IN lower(pg_get_expr(p.polqual,p.polrelid))) > 0 AND
          position('customer_id' IN lower(pg_get_expr(p.polqual,p.polrelid))) > 0
        ),false) AS customer_user_policy
 FROM wallet_tables w
 JOIN pg_class c ON c.oid=('public.' || w.table_name)::regclass
 LEFT JOIN pg_policy p ON p.polrelid=c.oid
 GROUP BY w.table_name,c.relrowsecurity
)
SELECT 'grant|' || key || '|' || allowed FROM grants
UNION ALL SELECT 'rls|' || table_name || '|' || rls_enabled || '|' || customer_user_policy FROM policies
UNION ALL SELECT 'rpc|get_storefront_payment_settings|' ||
 has_function_privilege('authenticated','public.get_storefront_payment_settings(uuid)','EXECUTE');
ROLLBACK;
"""


def check_docker_database(run=subprocess.run):
    try:
        result = run(
            ['/usr/bin/docker', 'exec', '-i', CONTAINER, '/usr/bin/psql', '-X',
             '--set=ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align',
             '--field-separator=|', '-U', 'postgres', '-d', 'postgres'],
            input=_sql(), capture_output=True, text=True, timeout=20, check=False,
            env={'HOME': '/root', 'LANG': 'C', 'LC_ALL': 'C', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused('database_docker_readonly_unavailable') from error
    if result.returncode:
        raise Refused('database_docker_readonly_unavailable')
    rows = result.stdout.splitlines()
    grants = [row for row in rows if row.startswith('grant|')]
    rls = [row for row in rows if row.startswith('rls|')]
    rpc = [row for row in rows if row.startswith('rpc|')]
    if (len(grants) != sum(map(len, (SUPPORTING_COLUMNS | REQUIRED_COLUMNS).values()))
            or len(rls) != len(REQUIRED_COLUMNS) or len(rpc) != 1):
        raise Refused('database_contract_incomplete')
    if any(row.rsplit('|', 1)[-1] != 'true' for row in grants):
        raise Refused('authenticated_column_grants_missing')
    if any(row.split('|')[-2:] != ['true', 'true'] for row in rls):
        raise Refused('wallet_customer_rls_contract_missing')
    if rpc[0] != 'rpc|get_storefront_payment_settings|true':
        raise Refused('settings_rpc_execute_missing')
    return {'authenticatedColumns': len(grants), 'customerScopedWalletTables': len(rls),
            'settingsRpcExecute': True, 'databaseReadOnly': True}
