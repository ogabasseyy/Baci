import base64
import copy
import hashlib
import hmac
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import public_projection as projection
from runtime_configuration import build_runtime_configuration
from treasury_owner_contract import DEADLINE_EPOCH, Refused


NOW = DEADLINE_EPOCH - 3600
SECRET = 'synthetic-signing-secret-not-a-live-key'


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


def token(role='anon', secret=SECRET, **claims):
    unsigned = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({
        'role': role, 'iss': 'supabase', 'iat': NOW - 60, 'exp': DEADLINE_EPOCH + 86400, **claims})
    signature = hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest()
    return unsigned + '.' + base64.urlsafe_b64encode(signature).decode().rstrip('=')


def source():
    template = json.loads(Path(__file__).with_name('activation-config.template.json').read_bytes())
    value = build_runtime_configuration(template, '-----BEGIN CERTIFICATE-----\nY2VydA==\n-----END CERTIFICATE-----',
        'test_key_synthetic', 'sk_test_synthetic', {'prefunded_treasury_operator': 'a' * 64,
            'prefunded_authorizer': 'b' * 64, 'prefunded_evidence': 'c' * 64})
    return json.dumps(value).encode()


def auth():
    return {'Name': '/baci-isolated-savings-auth-1', 'State': {'Running': True}, 'Config': {
        'Labels': {'com.docker.compose.project': 'baci-isolated-savings', 'com.docker.compose.service': 'auth'},
        'Env': ['GOTRUE_JWT_SECRET=' + SECRET,
                'GOTRUE_JWT_ISSUER=https://staging-auth.ogabassey.com/auth/v1']}}


def funding(key=None):
    return ('NEXT_PUBLIC_SUPABASE_URL=https://staging-auth.ogabassey.com\n'
            'NEXT_PUBLIC_SUPABASE_ANON_KEY="' + (key or token()) + '"\nPVB_SECRET=must-not-project\n').encode()


class ProjectionTests(unittest.TestCase):
    def project(self, raw=None):
        raw = source() if raw is None else raw
        with patch.object(projection, 'ACTIVATION_SHA256', hashlib.sha256(raw).hexdigest()):
            return projection.project_checkout(raw, NOW)

    def test_projects_original_public_section_only_without_worker_secrets(self):
        output = self.project()
        self.assertEqual(json.loads(output), json.loads(source())['publicCheckout'])
        for forbidden in (b'test_key_synthetic', b'c' * 64, b'receiverReplayRuntime', b'background'):
            self.assertNotIn(forbidden, output)
        self.assertIn(b'sk_test_synthetic', output)

    def test_full_protected_source_hash_and_expiry_are_mandatory(self):
        with self.assertRaises(Refused):
            projection.project_checkout(source(), NOW)
        with patch.object(projection, 'ACTIVATION_SHA256', hashlib.sha256(source()).hexdigest()):
            with self.assertRaises(Refused):
                projection.project_checkout(source(), DEADLINE_EPOCH)

    def test_rejects_every_required_null_and_unexpected_public_field(self):
        value = json.loads(source())
        paths = []

        def visit(current, route):
            if isinstance(current, dict):
                for key, child in current.items():
                    paths.append([*route, key])
                    visit(child, [*route, key])

        visit(value['publicCheckout'], [])
        for route in paths:
            changed = copy.deepcopy(value)
            current = changed['publicCheckout']
            for key in route[:-1]:
                current = current[key]
            current[route[-1]] = None
            with self.subTest(route=route), self.assertRaises(Refused):
                self.project(json.dumps(changed).encode())
        value['publicCheckout']['background'] = {'secret': 'never-copy'}
        with self.assertRaises(Refused):
            self.project(json.dumps(value).encode())

    def test_rejects_scope_role_budget_origin_and_deadline_drift(self):
        cases = [('maximumAmountKobo', 10001), ('maximumAmountKobo', True),
                 ('expiresAt', '2026-10-01T00:00:00Z'), ('publicOrigin', 'https://production.invalid')]
        for key, replacement in cases:
            value = json.loads(source())
            value['publicCheckout'][key] = replacement
            with self.subTest(key=key), self.assertRaises(Refused):
                self.project(json.dumps(value).encode())
        value = json.loads(source())
        value['publicCheckout']['checkout']['customerDatabase']['login'] = 'postgres'
        with self.assertRaises(Refused):
            self.project(json.dumps(value).encode())

    def test_anon_uses_only_two_fields_and_runtime_signature(self):
        key = token()
        result = projection.project_anon(funding(key), auth(), NOW)
        self.assertEqual(json.loads(result), {'url': 'https://staging-auth.ogabassey.com', 'key': key})

    def test_anon_rejects_fake_service_expired_and_wrong_signature(self):
        for key in ('fake-anon-key', token('service_role'), token(secret='foreign'), token(exp=NOW),
                    token(exp=None), token(iat=NOW + 1), token(nbf=NOW + 1)):
            with self.subTest(kind=key[:5]), self.assertRaises(Refused):
                projection.project_anon(funding(key), auth(), NOW)

    def test_anon_rejects_wrong_runtime_project_or_issuer_or_duplicate_env(self):
        for mutation in ('project', 'issuer', 'duplicate', 'stopped'):
            observed = auth()
            if mutation == 'project':
                observed['Config']['Labels']['com.docker.compose.project'] = 'foreign'
            elif mutation == 'issuer':
                observed['Config']['Env'][1] = 'GOTRUE_JWT_ISSUER=https://foreign/auth/v1'
            elif mutation == 'duplicate':
                observed['Config']['Env'].append('GOTRUE_JWT_SECRET=another')
            else:
                observed['State']['Running'] = False
            with self.subTest(mutation=mutation), self.assertRaises(Refused):
                projection.project_anon(funding(), observed, NOW)

    def test_anon_rejects_origin_duplicates_interpolation_and_expired_approval(self):
        for content in (funding().replace(b'staging-auth.', b'foreign.'),
                        funding() + b'NEXT_PUBLIC_SUPABASE_ANON_KEY=duplicate\n',
                        funding().replace(token().encode(), b'$(cat /secret)')):
            with self.assertRaises(Refused):
                projection.project_anon(content, auth(), NOW)
        with self.assertRaises(Refused):
            projection.project_anon(funding(), auth(), DEADLINE_EPOCH)


if __name__ == '__main__':
    unittest.main()
