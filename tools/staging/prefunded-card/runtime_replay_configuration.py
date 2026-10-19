import base64
import binascii
import hashlib
import hmac
import json
import re
import time
from treasury_owner_contract import DEADLINE_EPOCH, Refused, SYSTEM


ROLES = {'receiptToken': ('pvb_staging_worker', 'pvb-staging-receipts'),
         'appToken': ('pvb_staging_app_worker', 'authenticated')}
FIELDS = {'environment', 'receiptSystemId', 'appSystemId', 'receiptKey', *ROLES}


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')


def decode(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise Refused('Replay token encoding refused')
    result = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    if base64.urlsafe_b64encode(result).rstrip(b'=').decode() != value:
        raise Refused('Replay token encoding refused')
    return result


def prepare_replay_configuration(original, signing_keys, receipt_key, now=None, deadline=DEADLINE_EPOCH):
    now = int(time.time()) if now is None else now
    if type(now) is not int or type(deadline) is not int or not 180 < deadline - now <= 604800:
        raise Refused('Replay credential window refused')
    if (not isinstance(original, dict) or set(original) != FIELDS
            or original.get('environment') != 'staging' or original.get('appSystemId') != SYSTEM
            or original.get('receiptSystemId') != '7686901100561231906'
            or not isinstance(signing_keys, dict) or set(signing_keys) != set(ROLES)
            or not isinstance(receipt_key, str) or original.get('receiptKey') != receipt_key):
        raise Refused('Replay credential scope refused')
    try:
        raw_key = base64.b64decode(receipt_key, validate=True)
        if len(raw_key) != 32 or base64.b64encode(raw_key).decode() != receipt_key:
            raise ValueError()
        prepared = dict(original)
        for name, (role, audience) in ROLES.items():
            secret = signing_keys[name]
            if not isinstance(secret, str) or not 32 <= len(secret) <= 4096:
                raise ValueError()
            token = original[name]
            if not isinstance(token, str) or len(token) > 8192:
                raise ValueError()
            header, body, signature = token.split('.')
            expected = hmac.new(secret.encode(), (header + '.' + body).encode(), hashlib.sha256).digest()
            if (json.loads(decode(header)) != {'alg': 'HS256', 'typ': 'JWT'}
                    or not hmac.compare_digest(decode(signature), expected)):
                raise ValueError()
            claims = json.loads(decode(body))
            if (set(claims) != {'role', 'aud', 'iat', 'exp'} or claims['role'] != role
                    or claims['aud'] != audience or type(claims['iat']) is not int
                    or type(claims['exp']) is not int or not 0 < claims['exp'] - claims['iat'] <= 604800
                    or claims['iat'] > now + 60):
                raise ValueError()
            refreshed = b'.'.join((encode({'alg': 'HS256', 'typ': 'JWT'}),
                                   encode(dict(role=role, aud=audience, iat=now, exp=deadline))))
            signed = hmac.new(secret.encode(), refreshed, hashlib.sha256).digest()
            prepared[name] = (refreshed + b'.' + base64.urlsafe_b64encode(signed).rstrip(b'=')).decode()
        return prepared
    except (ValueError, TypeError, KeyError, binascii.Error):
        raise Refused('Replay credential proof refused') from None
