import base64
import hashlib
import hmac
import json
import re
import shlex

from treasury_owner_contract import BUSINESS, DEADLINE, DEADLINE_EPOCH, HOST, INTEGRATION, MERCHANT, SYSTEM, TREASURY, Refused


ACTIVATION_SHA256 = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
AUTH_ORIGIN = 'https://staging-auth.ogabassey.com'
PUBLIC_ORIGIN = 'https://staging.ogabassey.com'
PROJECT = 'baci-isolated-savings'
CUSTOMER = '10000000-0000-4000-8000-000000000002'


def serialized(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def parsed(content):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError()
            result[key] = value
        return result
    try:
        return json.loads(content, object_pairs_hook=unique, parse_constant=lambda _: None)
    except (ValueError, UnicodeError):
        raise Refused('Public JSON input refused') from None


def project_checkout(content, now):
    if now >= DEADLINE_EPOCH or hashlib.sha256(content).hexdigest() != ACTIVATION_SHA256:
        raise Refused('Protected public source pin or deadline refused')
    try:
        public = parsed(content)['publicCheckout']
        checkout = public['checkout']
        scope = dict(deployment='staging', integrationId=INTEGRATION, merchantId=MERCHANT,
                     treasuryBindingId=TREASURY, businessId=BUSINESS, systemIdentifier=SYSTEM, expiresAt=DEADLINE)
        databases = {}
        for key, profile, role in (('customerDatabase', 'checkout_customer', 'prefunded_treasury_operator'),
                                   ('verifierDatabase', 'checkout_authorizer', 'prefunded_authorizer')):
            database = checkout[key]
            password, certificate = database['password'], database['certificateAuthority']
            if (not isinstance(password, str) or not re.fullmatch('[A-Za-z0-9_-]{64}', password)
                    or not isinstance(certificate, str) or len(certificate) > 32768
                    or not re.fullmatch(r'-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*', certificate)):
                raise ValueError()
            databases[key] = dict(environment='staging', profile=profile, transport='tls', host=HOST,
                expectedHost=HOST, port=5432, login=role, expectedLogin=role, database='postgres',
                expectedDatabase='postgres', expectedSystemId=SYSTEM, expectedProjectId=PROJECT,
                actualProjectId=PROJECT, certificateAuthority=certificate, password=password, storageApproved=True)
        secret = checkout['provider']['paystackSecret']
        if not isinstance(secret, str) or not re.fullmatch('sk_test_[A-Za-z0-9]+', secret):
            raise ValueError()
        expected = dict(deployment='staging', expiresAt=DEADLINE, publicOrigin=PUBLIC_ORIGIN,
            authOrigin=AUTH_ORIGIN, maximumAmountKobo=10000,
            context=dict(environment='staging', transport='tls', integrationId=INTEGRATION,
                expectedBusinessId=BUSINESS, merchantId=MERCHANT, allowlistedMerchantIds=[MERCHANT],
                allowlistedCustomerIds=[CUSTOMER], expectedProjectId=PROJECT, actualProjectId=PROJECT),
            checkout=dict(scope=scope, **databases,
                provider=dict(**scope, paystackSecret=secret, callbackUrl=PUBLIC_ORIGIN + '/savings/card-return')))
        if serialized(public) != serialized(expected):
            raise ValueError()
        return serialized(public)
    except (KeyError, TypeError, ValueError):
        raise Refused('Public checkout scope refused') from None


def project_anon(content, observed_auth, now):
    try:
        values = {}
        for line in content.decode().splitlines():
            name, separator, raw = line.strip().partition('=')
            if name not in ('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'):
                continue
            parts = shlex.split(raw)
            if name in values or not separator or len(parts) != 1:
                raise ValueError()
            values[name] = parts[0]
        key = values['NEXT_PUBLIC_SUPABASE_ANON_KEY']
        if now >= DEADLINE_EPOCH or values['NEXT_PUBLIC_SUPABASE_URL'] != AUTH_ORIGIN or len(key) > 8192:
            raise ValueError()
        config = observed_auth['Config']
        if (observed_auth['Name'] != '/' + PROJECT + '-auth-1' or observed_auth['State']['Running'] is not True
                or config['Labels']['com.docker.compose.project'] != PROJECT
                or config['Labels']['com.docker.compose.service'] != 'auth'):
            raise ValueError()
        environment = {}
        for item in config['Env']:
            name, separator, value = item.partition('=')
            if not separator or name in environment:
                raise ValueError()
            environment[name] = value
        signing_key = environment['GOTRUE_JWT_SECRET']
        if len(signing_key) < 32 or environment['GOTRUE_JWT_ISSUER'] != AUTH_ORIGIN + '/auth/v1':
            raise ValueError()
        parts = key.split('.')
        if len(parts) != 3 or any(not re.fullmatch('[A-Za-z0-9_-]+', part) for part in parts):
            raise ValueError()
        header, claims, signature = [base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)) for part in parts]
        if parsed(header) != {'alg': 'HS256', 'typ': 'JWT'}:
            raise ValueError()
        claims = parsed(claims)
        expected = hmac.new(signing_key.encode(), '.'.join(parts[:2]).encode(), hashlib.sha256).digest()
        if (not hmac.compare_digest(signature, expected) or claims['role'] != 'anon'
                or type(claims.get('exp')) is not int or claims['exp'] < DEADLINE_EPOCH
                or any(type(claims[name]) is not int or claims[name] > now for name in ('iat', 'nbf') if name in claims)):
            raise ValueError()
        return serialized(dict(url=AUTH_ORIGIN, key=key))
    except (KeyError, TypeError, ValueError, AttributeError, UnicodeError):
        raise Refused('Approved staging anon provenance refused') from None
