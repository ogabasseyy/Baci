import base64
import hashlib
import hmac
import json
import unittest

from renewal_contract import OLD_EPOCH, TARGET_EPOCH, Refused, canonical
from activation_credentials import funding_environment, public_jwt, unit_anon_key


SECRET = 'fixture-signing-secret-not-a-live-credential'
NOW = OLD_EPOCH + 3600


def encode(value):
    return base64.urlsafe_b64encode(canonical(value)).rstrip(b'=')


def token(claims=None, header=None, secret=SECRET):
    claims = claims or {'role': 'anon', 'iss': 'https://staging-auth.ogabassey.com/auth/v1',
                        'aud': 'authenticated', 'iat': NOW - 100, 'exp': TARGET_EPOCH + 100}
    message = encode(header or {'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode(claims)
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), message, hashlib.sha256).digest()).rstrip(b'=')
    return (message + b'.' + signature).decode()


def environment():
    values = {
        'BACI_SAVINGS_LEASE_EXPIRES_AT': str(OLD_EPOCH),
        'NEXT_PUBLIC_SUPABASE_URL': 'https://staging-auth.ogabassey.com',
        'NEXT_PUBLIC_APP_URL': 'https://staging.ogabassey.com',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': token(),
        'PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED': 'true',
        'PIGGYVEST_SAVINGS_FUNDING_API_SECRET': 'test_key_fixture-never-print',
        'PIGGYVEST_SAVINGS_FUNDING_BUSINESS_ID': '01M2381RG34HQJMHQKE7DWDACR',
        'PIGGYVEST_SAVINGS_FUNDING_INTEGRATION_ID': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
        'PIGGYVEST_SAVINGS_FUNDING_MERCHANT_ID': '10000000-0000-4000-8000-000000000001',
        'PIGGYVEST_SAVINGS_FUNDING_PROJECT_ID': 'isolated-fixture-project',
        'PIGGYVEST_SAVINGS_FUNDING_CUSTOMER_ALLOWLIST': '10000000-0000-4000-8000-000000000002',
        'PIGGYVEST_SAVINGS_FUNDING_FINGERPRINT_KEY': 'fixture-fingerprint-key-never-print-32',
        'PIGGYVEST_SAVINGS_FUNDING_DB_HOST': 'piggyvest-db.staging.baci.internal',
        'PIGGYVEST_SAVINGS_FUNDING_DB_PORT': '5432',
        'PIGGYVEST_SAVINGS_FUNDING_DB_NAME': 'postgres',
        'PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD': 'fixture-password-never-print',
    }
    return ('\n'.join(f'{name}={value}' for name, value in values.items()) + '\n').encode()


class CredentialProofTests(unittest.TestCase):
    def test_existing_anon_is_verified_without_exposing_signing_material(self):
        proof = public_jwt(token(), SECRET, NOW)
        self.assertTrue(proof['signatureVerified'])
        self.assertTrue(proof['coversRequestedDeadline'])
        self.assertNotIn(SECRET, json.dumps(proof))
        self.assertNotIn(token(), json.dumps(proof))

    def test_expiry_claim_without_a_valid_signature_is_not_authority(self):
        with self.assertRaises(Refused):
            public_jwt(token(secret='wrong-fixture-secret'), SECRET, NOW)
        with self.assertRaises(Refused):
            public_jwt(token(header={'alg': 'none', 'typ': 'JWT'}), SECRET, NOW)

    def test_rejects_wrong_issuer_audience_role_future_issue_and_short_expiry(self):
        claims = {'role': 'anon', 'iss': 'https://staging-auth.ogabassey.com/auth/v1',
                  'aud': 'authenticated', 'iat': NOW - 100, 'exp': TARGET_EPOCH + 100}
        for field, value in (('role', 'service_role'), ('iss', 'https://production/auth/v1'),
                             ('aud', 'other'), ('iat', NOW + 1), ('exp', NOW - 1),
                             ('exp', TARGET_EPOCH), ('iat', True)):
            with self.subTest(field=field, value=value), self.assertRaises(Refused):
                public_jwt(token({**claims, field: value}), SECRET, NOW)

    def test_duplicate_json_and_noncanonical_encoding_are_refused(self):
        pieces = token().split('.')
        with self.assertRaises(Refused):
            public_jwt(pieces[0] + '=.' + pieces[1] + '.' + pieces[2], SECRET, NOW)
        message = pieces[0].encode() + b'.' + base64.urlsafe_b64encode(b'{"role":"anon","role":"anon"}').rstrip(b'=')
        signature = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), message, hashlib.sha256).digest()).rstrip(b'=')
        with self.assertRaises(Refused):
            public_jwt((message + b'.' + signature).decode(), SECRET, NOW)

    def test_environment_proves_sandbox_scope_without_evaluating_values(self):
        values, metadata = funding_environment(environment())
        self.assertEqual(values['PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD'], 'fixture-password-never-print')
        self.assertEqual(metadata['databaseRole'], 'piggyvest_staging_provisioner')
        self.assertFalse(metadata['usesProvisionerJwt'])
        self.assertNotIn('never-print', json.dumps(metadata))
        self.assertEqual(unit_anon_key(f'Environment=NEXT_PUBLIC_SUPABASE_ANON_KEY={token()}\n'.encode()), token())

    def test_duplicate_env_production_secret_expanded_allowlist_and_ambiguous_unit_refuse(self):
        bad = (
            environment() + b'PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD=second\n',
            environment().replace(b'test_key_fixture-never-print', b'live_key_fixture'),
            environment().replace(b'10000000-0000-4000-8000-000000000002\n', b'other-customer\n'),
            environment() + b'UNAPPROVED_SECRET=hidden\n',
            environment() + b'BROKEN="unterminated\n',
        )
        for content in bad:
            with self.subTest(content=content[-40:]), self.assertRaises(Refused):
                funding_environment(content)
        with self.assertRaises(Refused):
            unit_anon_key(f'Environment=NEXT_PUBLIC_SUPABASE_ANON_KEY={token()}\n'.encode() * 2)


if __name__ == '__main__':
    unittest.main()
