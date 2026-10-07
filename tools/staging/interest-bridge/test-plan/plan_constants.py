SCOPE = {
    'environment': 'staging',
    'systemIdentifier': '7685292944002592802',
    'merchantId': '10000000-0000-4000-8000-000000000001',
    'customerId': '10000000-0000-4000-8000-000000000002',
    'actorId': 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3',
    'integrationId': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'businessId': '01M2381RG34HQJMHQKE7DWDACR',
    'oldGoalId': '430314fd-cd8b-4579-98d4-e9f345713dd6',
    'publicWalletId': '01M3W0Y93XHJY9RPQ2G75X81WG',
    'faasWalletId': '01M3W0YENHMFJ8Z9FS76E3CC6T',
    'apiCustomerId': '01M2T3PAHG3P5A32REX8MH3HD7',
    'webhookCustomerId': 'c096507d-dc32-45d2-9c01-871a27abfd10',
}
OLD_WALLET = '01M3CQX27G9687EFSF1TKYMPR9'
OLD_FAAS = '01M3CQX7RN5JCKJD7NSJZZGE4B'
DEADLINE = '2026-10-06T15:59:10Z'
PLAN_KEY = 'pvb-empty-interest-staging-20261002-v1'
TITLE = 'PiggyVest empty interest staging test'
IDENTITY_SHA = '8d0a4f90a2f96182776baf91148b3bd3b27a3323eaff8d37362e24511b52d327'
PROVIDER_HELPER = '/home/bassey/baci-interest-confirm-20261001.o5wK6hku/provider_interest_check.py'
PROVIDER_HELPER_SHA = '900b18bc7b25823a8ea36a663ee856a64eb8d37511502b45a3d5d9659ba365b1'
ORIGIN = 'https://staging.piggyvest.business'
PSQL = ['docker', 'exec', '-i', 'baci-isolated-savings-db-1',
        '/nix/var/nix/profiles/default/bin/psql', '-U', 'postgres', '-d', 'postgres',
        '-X', '-Atq', '-v', 'ON_ERROR_STOP=1']
MAX_BYTES = 1048576
MAX_INVENTORY_BYTES = 8 * MAX_BYTES
