import hashlib
import re
import urllib.parse

INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
MERCHANT = '10000000-0000-4000-8000-000000000001'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
CLUSTER = '7685292944002592802'
EXPIRY = 1790697550


def wallet_name(integration, goal):
    digest = hashlib.sha256(f'{integration}:{goal}'.encode()).hexdigest()
    return 'baci' + digest[:40]


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,64}', value):
        raise RuntimeError('Invalid provider identifier')
    return value


def verify_wallet(wallet, scope):
    if not isinstance(wallet, dict) or any((
        wallet.get('api_customer_id') != scope['apiCustomerId'],
        wallet.get('business_id') != scope['businessId'],
        wallet.get('name') != scope['name'],
        wallet.get('currency') != 'NGN', wallet.get('status') != 'active',
    )):
        raise RuntimeError('Provider wallet identity not verified')
    if scope.get('enableInterestAccrual', False) and wallet.get('interest_enabled') is not True:
        raise RuntimeError('Existing wallet interest accrual is not verified; provider activation required')
    return identifier(wallet.get('id'))


def verify_source_wallet(wallet, source_wallet_id):
    if not isinstance(wallet, dict) or any((
        wallet.get('id') != source_wallet_id,
        wallet.get('business_id') != BUSINESS,
        wallet.get('currency') != 'NGN', wallet.get('status') != 'active',
    )):
        raise RuntimeError('Existing mapped provider wallet unavailable')
    return identifier(wallet.get('api_customer_id'))


def ensure_wallet(api, scope, journal, save):
    enable_interest_accrual = scope.get('enableInterestAccrual', False)
    if not isinstance(enable_interest_accrual, bool):
        raise RuntimeError('Invalid interest accrual choice')
    if journal['phase'] != 'prepared' and journal.get('enableInterestAccrual', False) != enable_interest_accrual:
        raise RuntimeError('Interest accrual choice changed after provider dispatch')
    cursor = None
    matches = []
    for _ in range(10):
        query = {'customer_id': scope['apiCustomerId'], 'limit': 100}
        if cursor:
            query['cursor'] = cursor
        response = api('GET', '/api/v1/wallet/api/wallet-type?' + urllib.parse.urlencode(query))
        page = response.get('data', {}).get('paginatedPayload', {})
        if not isinstance(page.get('edges'), list):
            raise RuntimeError('Invalid provider wallet list')
        for entry in page['edges']:
            wallet = entry.get('node', entry)
            if wallet.get('name') == scope['name']:
                matches.append(verify_wallet(wallet, scope))
        info = page.get('pageInfo', {})
        if info.get('hasNextPage') is False:
            break
        if not info.get('endCursor') or info['endCursor'] == cursor:
            raise RuntimeError('Incomplete provider wallet list')
        cursor = info['endCursor']
    else:
        raise RuntimeError('Provider wallet list limit reached')
    if len(matches) > 1:
        raise RuntimeError('Provider wallet identity ambiguous')
    if matches:
        return matches[0]
    if journal['phase'] != 'prepared':
        raise RuntimeError('Prior provider request unresolved; no repeat POST')
    save({**journal, 'phase': 'dispatched', 'enableInterestAccrual': enable_interest_accrual})
    response = api('POST', '/api/v1/wallet/sub-account', {
        'customer_id': scope['apiCustomerId'], 'subaccount_name': scope['name'],
        'reserve_virtual_account': True, 'enable_interest_accrual': enable_interest_accrual,
    })
    if response.get('status') is not True:
        raise RuntimeError('Provider request unresolved; reconcile before retry')
    return identifier(response.get('data', {}).get('id'))
