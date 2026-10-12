#!/usr/bin/env python3
"""Read-only, redacted gateway and wallet-grant diagnostic for staging."""

import argparse
import json
import os
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SERVICE = 'baci-savings-gateway.service'
GATEWAY = 'http://127.0.0.1:4795'
REQUIRED_ROUTES = {
    '/rest/v1/merchants': {'GET', 'HEAD'},
    '/rest/v1/customers': {'GET', 'HEAD'},
    '/rest/v1/customer_wallets': {'GET', 'HEAD'},
    '/rest/v1/customer_wallet_transactions': {'GET', 'HEAD'},
    '/rest/v1/customer_wallet_payment_accounts': {'GET', 'HEAD'},
    '/rest/v1/customer_wallet_accounts': {'GET', 'HEAD'},
    '/rest/v1/customer_savings_goals': {'GET', 'HEAD'},
    '/rest/v1/rpc/get_storefront_payment_settings': {'POST'},
}
def run(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=12, check=False)
    if result.returncode:
        raise RuntimeError('systemd inspection failed')
    return result.stdout


def gateway_status(path, method='GET'):
    try:
        with urlopen(Request(GATEWAY + path, method=method), timeout=5) as response:
            return response.status
    except HTTPError as error:
        return error.code
    except (URLError, TimeoutError, OSError):
        return None


def database_grants(pgservice):
    if not pgservice:
        return {'status': 'not_checked', 'reason': 'provide an approved libpq service alias'}
    query = """
WITH required(table_name, column_name) AS (
  SELECT * FROM (VALUES
    ('merchants','id'),('customers','id'),('customers','loyalty_points'),
    ('customer_wallets','id'),('customer_wallets','available_balance'),('customer_wallets','total_earned'),('customer_wallets','total_redeemed'),('customer_wallets','customer_id'),('customer_wallets','merchant_id'),
    ('customer_wallet_transactions','id'),('customer_wallet_transactions','type'),('customer_wallet_transactions','amount'),('customer_wallet_transactions','balance_after'),('customer_wallet_transactions','description'),('customer_wallet_transactions','created_at'),('customer_wallet_transactions','source_type'),('customer_wallet_transactions','wallet_id'),
    ('customer_wallet_payment_accounts','account_name'),('customer_wallet_payment_accounts','account_number'),('customer_wallet_payment_accounts','bank_name'),('customer_wallet_payment_accounts','provider'),('customer_wallet_payment_accounts','status'),('customer_wallet_payment_accounts','customer_id'),('customer_wallet_payment_accounts','merchant_id'),
    ('customer_wallet_accounts','available_balance'),('customer_wallet_accounts','currency'),('customer_wallet_accounts','customer_id'),('customer_wallet_accounts','merchant_id'),
    ('customer_savings_goals','current_amount'),('customer_savings_goals','status'),('customer_savings_goals','customer_id'),('customer_savings_goals','merchant_id')
  ) AS columns(table_name,column_name)
)
SELECT table_name || '.' || column_name || ':' || role_name || '=' ||
       has_column_privilege(role_name, 'public.' || table_name, column_name, 'SELECT')
FROM required CROSS JOIN (VALUES ('authenticated'), ('anon')) roles(role_name)
UNION ALL
SELECT 'function.get_storefront_payment_settings(uuid):' || role_name || '=' ||
       has_function_privilege(role_name, 'public.get_storefront_payment_settings(uuid)', 'EXECUTE')
FROM (VALUES ('authenticated'), ('anon')) roles(role_name);
"""
    try:
        result = subprocess.run(
            ['/usr/bin/psql', '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
             '--set=ON_ERROR_STOP=1', '--command', query],
            capture_output=True, text=True, timeout=15, check=False,
            env={**os.environ, 'PGSERVICE': pgservice},
        )
    except (OSError, subprocess.SubprocessError):
        return {'status': 'unavailable'}
    if result.returncode:
        return {'status': 'unavailable'}
    entries = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition('=')
        if not separator or value not in {'t', 'f'}:
            return {'status': 'invalid_result'}
        entries[key] = value == 't'
    return {'status': 'checked', 'columnSelect': entries}


def collect(pgservice=None, command=None):
    command = command or run
    state_lines = command([
        '/usr/bin/systemctl', 'show', SERVICE,
        '--property=ActiveState,MainPID,Result,ExecMainStatus', '--no-pager',
    ])
    state = {}
    for line in state_lines.splitlines():
        key, separator, value = line.partition('=')
        if separator and key in {'ActiveState', 'MainPID', 'Result', 'ExecMainStatus'}:
            state[key] = value
    if set(state) != {'ActiveState', 'MainPID', 'Result', 'ExecMainStatus'} or not state['MainPID'].isdigit() or not state['ExecMainStatus'].isdigit():
        raise RuntimeError('systemd metadata invalid')
    bindings = {}
    try:
        with open('/etc/baci-savings-gateway/binding.json', encoding='utf-8') as source:
            binding = json.load(source)
        for route in binding['identity']['restRoutes']:
            if isinstance(route, dict) and isinstance(route.get('path'), str) and isinstance(route.get('methods'), list):
                bindings[route['path']] = set(route['methods'])
    except (OSError, ValueError, KeyError, TypeError):
        binding = None
    route_state = {}
    for path, methods in REQUIRED_ROUTES.items():
        route_state[path] = {
            'allowlisted': methods.issubset(bindings.get(path, set())) if binding is not None else None,
            'unauthenticatedHttpStatus': None,
        }
    return {
        'service': {
            'activeState': state['ActiveState'],
            'mainPidPresent': int(state['MainPID']) > 0,
            'result': state['Result'],
            'execMainStatus': int(state['ExecMainStatus']),
        },
        'bindingReadable': binding is not None,
        'routeChecks': route_state,
        'databaseGrants': database_grants(pgservice),
        'readOnly': True,
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', required=True)
    parser.add_argument('--pgservice', help='root-configured libpq service alias; credentials stay in libpq configuration')
    arguments = parser.parse_args(argv)
    if os.geteuid() != 0:
        print('Refused: run the read-only diagnostic with owner sudo.', file=sys.stderr)
        return 1
    try:
        result = collect(arguments.pgservice)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        print('Diagnostic unavailable; no service or database changes were made.', file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
