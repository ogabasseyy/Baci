import base64
import hashlib
import hmac
import json

from readiness_evidence_io import DEADLINE, EPOCH, Refused, digest, require, window
from release_contract import FACTORY
from treasury_owner_contract import BUSINESS, INTEGRATION, MERCHANT, SYSTEM, TREASURY

ROLES = {'receiptToken': ('pvb_staging_worker', 'pvb-staging-receipts'),
         'appToken': ('pvb_staging_app_worker', 'authenticated')}
FIELDS = {'environment', 'appSystemId', 'receiptSystemId', 'receiptKey', *ROLES, 'prefundedReplay'}
FACTORY_SCOPE = {'environment': 'staging', 'integrationId': INTEGRATION,
    'merchantId': MERCHANT, 'treasuryBindingId': TREASURY, 'businessId': BUSINESS, 'expectedSystemId': SYSTEM}


def segment(value):
    import re
    require(isinstance(value, str) and re.fullmatch('[A-Za-z0-9_-]+', value), 'jwt_encoding_refused')
    decoded = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    require(base64.urlsafe_b64encode(decoded).rstrip(b'=').decode() == value, 'jwt_encoding_refused')
    return decoded


def verify(base, factory_bytes, keys, now):
    window(now)
    require(isinstance(base, dict) and set(base) == FIELDS
            and base['environment'] == 'staging' and base['appSystemId'] == '7685292944002592802'
            and base['receiptSystemId'] == '7686901100561231906', 'replay_mode_refused')
    require(base['prefundedReplay'] == {'bundleSha256': FACTORY,
            'configurationSha256': digest(factory_bytes)}, 'factory_configuration_pin_refused')
    require(isinstance(keys, dict) and set(keys) == set(ROLES), 'signing_keys_refused')
    try:
        factory = json.loads(factory_bytes)
        require(set(factory) == {'scope', 'evidence', 'database'}
                and set(factory['database']) == {'treasury', 'ingestion'}
                and factory['scope'] == FACTORY_SCOPE, 'factory_mode_refused')
        receipt_key = base64.b64decode(base['receiptKey'], validate=True)
        require(len(receipt_key) == 32 and base64.b64encode(receipt_key).decode() == base['receiptKey'],
                'receipt_key_refused')
        for name, (role, audience) in ROLES.items():
            secret = keys[name]
            require(isinstance(secret, str) and 32 <= len(secret) <= 4096, 'signing_keys_refused')
            token = base[name]
            require(isinstance(token, str) and len(token) <= 8192, 'jwt_refused')
            header, payload, signature = token.split('.')
            expected = hmac.new(secret.encode(), (header + '.' + payload).encode(), hashlib.sha256).digest()
            require(json.loads(segment(header)) == {'alg': 'HS256', 'typ': 'JWT'}
                    and hmac.compare_digest(segment(signature), expected), 'jwt_signature_refused')
            claims = json.loads(segment(payload))
            require(isinstance(claims, dict) and set(claims) == {'role', 'aud', 'iat', 'exp'}
                    and claims['role'] == role and claims['aud'] == audience
                    and type(claims['iat']) is int and 0 <= claims['iat'] <= now
                    and type(claims['exp']) is int and claims['exp'] == EPOCH
                    and 180 < claims['exp'] - now and 0 < claims['exp'] - claims['iat'] <= 604800,
                    'jwt_claims_refused')
    except (ValueError, TypeError, KeyError, AttributeError):
        raise Refused('readiness_evidence_jwt_or_configuration_refused') from None
    return {'jwtSignaturesVerified': True, 'jwtExpiresAt': DEADLINE,
            'prefundedReplayPresent': True, 'financialDatabaseAbsent': True}
