import base64
import hashlib
import hmac
import json
import re

import public_projection
import public_service_contract
from treasury_owner_contract import Refused


DEADLINE = '2026-10-06T15:59:10Z'
DEADLINE_EPOCH = 1791302350
OLD_DEADLINE = '2026-09-29T15:59:10Z'
OLD_ARCHIVE = '8f3babb4f2d6a9ecbbdc9d87c8209cbe45dbe6e124b7f059e1e391eeeb113134'
OLD_MANIFEST = '7790f11a4a4254c5c79d5841e92fc927163f29ed06007466696e9fd4d91f8bf3'
CONTAINER_MANIFEST = '525902e94dca498fe1d5a66c4be53b10335a7f663e07f62203c8f7fd81f77c82'
ARCHIVE = '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2'
MANIFEST = '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8'
LAUNCHER = 'd0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03'
ACTIVATION = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
CHECKOUT = '0672059a368dbd0dea38900827d5357e1561cc30d534e01a8926ce87dd208d84'
ANON = '4763e070945b3ab7a954c12e8da7ed9d3cd79b44b30ef6843eb2da567126934e'
RECEIPT = '1979a26e7c724acf78ca316cf6c557b2f98f0e766fa601bac35ad8ba4ddcef8d'
GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
FINANCIAL_CONTAINERS = ('pvb-staging-replay-prefunded', 'baci-prefunded-background',
                        'baci-prefunded-snapshot')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def parsed(content):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError()
            result[key] = value
        return result
    try:
        return json.loads(content, object_pairs_hook=unique,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, TypeError):
        raise Refused('json-contract') from None


def serialized(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def renew_checkout(activation, checkout):
    if digest(activation) != ACTIVATION or digest(checkout) != CHECKOUT:
        raise Refused('protected-config-pin')
    expected = public_projection.project_checkout(activation, 1790697549)
    value = parsed(checkout)
    if value != parsed(expected):
        raise Refused('protected-checkout-scope')
    scopes = (value, value['checkout']['scope'], value['checkout']['provider'])
    if any(scope.get('expiresAt') != OLD_DEADLINE for scope in scopes):
        raise Refused('checkout-expiry-contract')
    for scope in scopes:
        scope['expiresAt'] = DEADLINE
    return serialized(value)


def prove_receipt(content):
    if digest(content) != RECEIPT:
        raise Refused('receipt-pin')
    value = parsed(content)
    if (value.get('manifestSha256') != OLD_MANIFEST or value.get('archiveSha256') != OLD_ARCHIVE
            or value.get('deadline') != OLD_DEADLINE):
        raise Refused('receipt-artifact-pair')
    return value


def prove_anon(content, auth_container, now):
    if digest(content) != ANON or now >= DEADLINE_EPOCH:
        raise Refused('anon-pin-or-deadline')
    try:
        value = parsed(content)
        if set(value) != {'key', 'url'} or value['url'] != public_projection.AUTH_ORIGIN:
            raise ValueError()
        if (auth_container['Name'] != '/baci-isolated-savings-auth-1'
                or auth_container['State']['Running'] is not True
                or auth_container['Config']['Labels']['com.docker.compose.project'] != 'baci-isolated-savings'
                or auth_container['Config']['Labels']['com.docker.compose.service'] != 'auth'):
            raise ValueError()
        environment = {}
        for item in auth_container['Config']['Env']:
            name, separator, item_value = item.partition('=')
            if not separator or name in environment:
                raise ValueError()
            environment[name] = item_value
        secret = environment['GOTRUE_JWT_SECRET']
        if (len(secret) < 32
                or environment['GOTRUE_JWT_ISSUER'] != value['url'] + '/auth/v1'):
            raise ValueError()
        parts = value['key'].split('.')
        if len(parts) != 3 or any(not re.fullmatch('[A-Za-z0-9_-]+', part) for part in parts):
            raise ValueError()
        header, claims, signature = [base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))
                                     for part in parts]
        claims = parsed(claims)
        expected = hmac.new(secret.encode(), '.'.join(parts[:2]).encode(), hashlib.sha256).digest()
        if (parsed(header) != {'alg': 'HS256', 'typ': 'JWT'}
                or not hmac.compare_digest(signature, expected) or claims.get('role') != 'anon'
                or type(claims.get('exp')) is not int or claims['exp'] < DEADLINE_EPOCH
                or any(type(claims[name]) is not int or claims[name] > now
                       for name in ('iat', 'nbf') if name in claims)):
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError, UnicodeError):
        raise Refused('anon-signature-or-scope') from None


def renewed_units():
    original = public_service_contract.units()
    candidate = dict(original)
    service = 'baci-prefunded-public.service'
    timer = 'baci-prefunded-public-deadline.timer'
    if (candidate[service].count('1790697550') != 1
            or candidate[timer].count('2026-09-29 15:59:10 UTC') != 1):
        raise Refused('unit-source-contract')
    candidate[service] = candidate[service].replace('1790697550', str(DEADLINE_EPOCH))
    candidate[timer] = candidate[timer].replace('2026-09-29 15:59:10 UTC',
                                             '2026-10-06 15:59:10 UTC')
    return {name: content.encode() for name, content in candidate.items()}


def prove_protected_state(snapshot):
    state = snapshot.get('state', {})
    if (snapshot.get('systemIdentifier') != '7685292944002592802'
            or snapshot.get('readOnly') is not True or state.get('goalId') != GOAL
            or state.get('principalKobo') != 10000 or state.get('treasuryBudgetKobo') != 10000
            or state.get('treasuryReservedKobo') != 0 or state.get('treasuryConsumedKobo') != 0
            or state.get('treasuryAvailableKobo') != 10000
            or state.get('retiredIntentPhase') != 'retired_unconfirmed'
            or state.get('retiredIntentAmountKobo') != 10000
            or state.get('otherIntentCount') != 0 or state.get('otherOperationCount') != 0
            or state.get('retirementAuditCount') != 1 or state.get('newPaymentStarted') is not False
            or state.get('retiredOperation') != {
                'id': 'd8bcf921-61b3-4647-90e2-5648e4d6967d', 'retired': True,
                'collection': 'pending', 'transfer': 'not_started', 'projection': 'unapplied'}):
        raise Refused('protected-financial-state')
    roles = snapshot.get('roles')
    if (not isinstance(roles, list) or len(roles) != 3
            or {role.get('name') for role in roles} != {
                'prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence'}
            or any(role.get('present') is not True or role.get('login') is not True
                   or role.get('unsafe') is not False for role in roles)):
        raise Refused('protected-database-roles')
    return snapshot


def prove_mutations_off(environment):
    if (not isinstance(environment, list) or not environment
            or any(not isinstance(item, str) or '=' not in item for item in environment)
            or any(item.split('=', 1)[0] == 'PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED'
                   for item in environment)):
        raise Refused('readonly-image-environment')
