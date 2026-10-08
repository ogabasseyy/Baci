from datetime import datetime, timezone
import json
import re


SYSTEM = '7685292944002592802'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
MERCHANT = '10000000-0000-4000-8000-000000000001'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
SOURCE = '01M238A0V75387H4HZ15YFWGX3'
DEADLINE = '2026-09-29T15:59:10Z'
DEADLINE_EPOCH = 1790697550
CONTAINER = 'baci-isolated-savings-db-1'
PSQL = '/nix/var/nix/profiles/default/bin/psql'
HOST = 'piggyvest-db.staging.baci.internal'
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


class Refused(Exception):
    pass


def validate_wallet(value):
    expected = dict(id=SOURCE, business_id=BUSINESS, currency='NGN', type='api', status='active')
    if (not isinstance(value, dict) or any(value.get(key) != item for key, item in expected.items())
            or type(value.get('balance')) is not int or value['balance'] != 10000
            or value.get('api_customer_id') or value.get('customer_id')):
        raise Refused('Provider treasury identity or approved balance changed')


def owner_input(password, now=None):
    now = now or datetime.now(timezone.utc)
    if now.timestamp() >= DEADLINE_EPOCH or not re.fullmatch(r'[A-Za-z0-9_-]{64}', password):
        raise Refused('Expired approval or invalid verifier password')
    return dict(systemIdentifier=SYSTEM, treasuryBindingId=TREASURY, integrationId=INTEGRATION,
                merchantId=MERCHANT, businessId=BUSINESS, sourceWalletId=SOURCE,
                openingAvailableKobo=10000, verifiedAt=now.isoformat(), expiresAt=DEADLINE,
                verifierPassword=password)


def render_candidate(source, snapshot, value, now=None):
    now = now or datetime.now(timezone.utc)
    if not isinstance(value, dict):
        raise Refused('Owner input shape refused')
    try:
        expected = owner_input(value['verifierPassword'], now)
        verified_at = datetime.fromisoformat(value['verifiedAt'].replace('Z', '+00:00'))
        if not 0 <= (now - verified_at).total_seconds() <= 30:
            raise ValueError()
    except (KeyError, ValueError, TypeError, AttributeError):
        raise Refused('Owner input refused') from None
    expected['verifiedAt'] = value['verifiedAt']
    if value != expected:
        raise Refused('Owner scope differs from approved sandbox treasury')
    snapshot = snapshot.strip()
    if (source.count('__OWNER_INPUT__') != 1 or source.count('__SNAPSHOT_SQL__') != 1
            or not snapshot.startswith('BEGIN;') or not snapshot.endswith('COMMIT;')
            or any(line.lstrip().startswith('\\') for line in (source + snapshot).splitlines())):
        raise Refused('Unexpected reviewed SQL template')
    serialized = json.dumps(value, sort_keys=True, separators=(',', ':')).replace("'", "''")
    body = snapshot[len('BEGIN;'):-len('COMMIT;')]
    return source.replace('__OWNER_INPUT__', "'" + serialized + "'").replace('__SNAPSHOT_SQL__', body)
