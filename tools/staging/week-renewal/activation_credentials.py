import base64
import hashlib
import hmac
import re

from renewal_contract import OLD_EPOCH, TARGET_EPOCH, Refused, parse_json


PREFIX = 'PIGGYVEST_SAVINGS_FUNDING_'
SCOPE = {
    'DISPLAY_ENABLED': 'true', 'BUSINESS_ID': '01M2381RG34HQJMHQKE7DWDACR',
    'INTEGRATION_ID': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'MERCHANT_ID': '10000000-0000-4000-8000-000000000001',
    'CUSTOMER_ALLOWLIST': '10000000-0000-4000-8000-000000000002',
    'DB_HOST': 'piggyvest-db.staging.baci.internal', 'DB_PORT': '5432', 'DB_NAME': 'postgres',
}
PUBLIC = {
    'NEXT_PUBLIC_SUPABASE_URL': 'https://staging-auth.ogabassey.com',
    'NEXT_PUBLIC_APP_URL': 'https://staging.ogabassey.com',
}
SECRET_NAMES = {PREFIX + name for name in ('API_SECRET', 'DB_PASSWORD', 'FINGERPRINT_KEY')}


def _decode(segment):
    if not isinstance(segment, str) or not re.fullmatch('[A-Za-z0-9_-]+', segment):
        raise Refused('public-jwt-encoding')
    try:
        content = base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4))
    except ValueError:
        raise Refused('public-jwt-encoding') from None
    if base64.urlsafe_b64encode(content).rstrip(b'=').decode() != segment:
        raise Refused('public-jwt-encoding')
    return content


def public_jwt(value, signing_secret, now):
    if (not isinstance(value, str) or not 1 <= len(value) <= 8192
            or not isinstance(signing_secret, str) or not 32 <= len(signing_secret) <= 4096
            or type(now) is not int or not OLD_EPOCH < now < TARGET_EPOCH):
        raise Refused('public-jwt-input')
    parts = value.split('.')
    if len(parts) != 3:
        raise Refused('public-jwt-shape')
    header, claims = [parse_json(_decode(part)) for part in parts[:2]]
    signature = _decode(parts[2])
    expected = hmac.new(signing_secret.encode(), '.'.join(parts[:2]).encode(), hashlib.sha256).digest()
    if header != {'alg': 'HS256', 'typ': 'JWT'} or not hmac.compare_digest(signature, expected):
        raise Refused('public-jwt-signature')
    if (not isinstance(claims, dict) or set(claims) != {'role', 'iss', 'aud', 'iat', 'exp'}
            or claims['role'] != 'anon' or claims['aud'] != 'authenticated'
            or claims['iss'] != 'https://staging-auth.ogabassey.com/auth/v1'
            or type(claims['iat']) is not int or type(claims['exp']) is not int
            or not 0 < claims['iat'] <= now < TARGET_EPOCH < claims['exp']):
        raise Refused('public-jwt-authority')
    return {'signatureVerified': True, 'role': 'anon', 'issuerVerified': True,
            'audienceVerified': True, 'expiresAtEpoch': claims['exp'], 'coversRequestedDeadline': True}


def unit_anon_key(content):
    try:
        matches = re.findall(r'^Environment=NEXT_PUBLIC_SUPABASE_ANON_KEY=([A-Za-z0-9_.-]+)$',
                             content.decode(), re.MULTILINE)
    except (AttributeError, UnicodeError):
        raise Refused('draft-public-jwt-line') from None
    if len(matches) != 1:
        raise Refused('draft-public-jwt-line')
    return matches[0]


def funding_environment(content):
    try:
        lines = content.decode('utf-8').splitlines()
    except (AttributeError, UnicodeError):
        raise Refused('funding-environment-format') from None
    values = {}
    for line in lines:
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        if not match or match[1] in values:
            raise Refused('funding-environment-duplicate-or-format')
        name, value = match.groups()
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0] or value[0] in value[1:-1]:
                raise Refused('funding-environment-quoting')
            value = value[1:-1]
        elif '"' in value or "'" in value or value != value.strip():
            raise Refused('funding-environment-quoting')
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise Refused('funding-environment-control')
        if (name != 'NEXT_PUBLIC_SUPABASE_ANON_KEY' and name not in SECRET_NAMES
                and re.search('SECRET|TOKEN|PASSWORD|PEPPER|KEY|CREDENTIAL', name)):
            raise Refused('funding-unapproved-credential')
        values[name] = value
    expected = {**{PREFIX + name: value for name, value in SCOPE.items()}, **PUBLIC,
                'BACI_SAVINGS_LEASE_EXPIRES_AT': str(OLD_EPOCH)}
    if any(values.get(name) != value for name, value in expected.items()):
        raise Refused('funding-sandbox-scope')
    if (not values.get(PREFIX + 'API_SECRET', '').startswith('test_key_')
            or not values.get(PREFIX + 'DB_PASSWORD')
            or not 32 <= len(values.get(PREFIX + 'FINGERPRINT_KEY', '')) <= 512
            or not re.fullmatch('[A-Za-z0-9_-]{1,128}', values.get(PREFIX + 'PROJECT_ID', ''))
            or not values.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')):
        raise Refused('funding-required-credential')
    return values, {'sandboxScopeVerified': True, 'databaseRole': 'piggyvest_staging_provisioner',
                    'databaseTransport': 'tls', 'usesProvisionerJwt': False,
                    'projectId': values[PREFIX + 'PROJECT_ID']}
