import base64
import copy
import hashlib
import hmac
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'prefunded-card'))
from interest_runtime_configuration import build_interest_configuration
from runtime_replay_configuration import encode
from treasury_owner_contract import Refused


NOW = 1790841600
KEYS = {'receiptToken': 'r' * 40, 'appToken': 'a' * 40}
CA = '-----BEGIN CERTIFICATE-----\neA==\n-----END CERTIFICATE-----\n'


def fixture():
    original = {'environment': 'staging', 'appSystemId': '7685292944002592802',
                'receiptSystemId': '7686901100561231906',
                'receiptKey': base64.b64encode(b'x' * 32).decode()}
    for name, role, audience in (('receiptToken', 'pvb_staging_worker', 'pvb-staging-receipts'),
                                 ('appToken', 'pvb_staging_app_worker', 'authenticated')):
        body = b'.'.join((encode({'alg': 'HS256', 'typ': 'JWT'}),
                          encode(dict(role=role, aud=audience, iat=NOW - 604800, exp=NOW - 1))))
        original[name] = (body + b'.' + base64.urlsafe_b64encode(
            hmac.new(KEYS[name].encode(), body, hashlib.sha256).digest()).rstrip(b'=')).decode()
    treasury = dict(environment='staging', transport='tls', host='piggyvest-db.staging.baci.internal',
                    expectedHost='piggyvest-db.staging.baci.internal', port=5432,
                    login='prefunded_treasury_operator', expectedLogin='prefunded_treasury_operator',
                    database='postgres', expectedDatabase='postgres',
                    expectedSystemId='7685292944002592802', expectedProjectId='baci-isolated-savings',
                    actualProjectId='baci-isolated-savings', certificateAuthority=CA,
                    password='p' * 64, storageApproved=True)
    prepared = dict(expected=dict(certificateAuthoritySha256=hashlib.sha256(CA.encode()).hexdigest()),
                    background=dict(database=dict(treasury=treasury), worker=dict(
                        integrationId='d91d9e87-8e0d-44de-9b84-1e1d709633d2',
                        businessId='01M2381RG34HQJMHQKE7DWDACR', expectedSystemId='7685292944002592802')))
    return original, prepared


class InterestRuntimeConfigurationTests(unittest.TestCase):
    def test_renews_verified_tokens_and_selects_only_the_existing_restricted_interest_credentials(self):
        original, prepared = fixture()
        before = copy.deepcopy((original, prepared))
        result = build_interest_configuration(original, KEYS, prepared, now=NOW)
        self.assertEqual(set(result), set(original) | {'financialDatabase'})
        self.assertEqual(result['receiptKey'], original['receiptKey'])
        for name in KEYS:
            claims = json.loads(base64.urlsafe_b64decode(result[name].split('.')[1] + '==='))
            self.assertEqual(claims['exp'], 1791302350)
        self.assertEqual(result['financialDatabase'], dict(
            host='piggyvest-db.staging.baci.internal', port=5432, database='postgres',
            role='prefunded_treasury_operator', password='p' * 64,
            integrationId='d91d9e87-8e0d-44de-9b84-1e1d709633d2',
            businessId='01M2381RG34HQJMHQKE7DWDACR', ssl={'ca': CA}))
        self.assertEqual((original, prepared), before)

    def test_refuses_tls_identity_project_password_or_certificate_drift(self):
        for key, value in [('host', 'other'), ('login', 'postgres'), ('transport', 'tcp'),
                           ('expectedSystemId', '123'), ('actualProjectId', 'other'),
                           ('storageApproved', False), ('password', 'short'),
                           ('certificateAuthority', CA + 'tampered')]:
            original, prepared = fixture()
            prepared['background']['database']['treasury'][key] = value
            with self.subTest(field=key), self.assertRaises(Refused):
                build_interest_configuration(original, KEYS, prepared, now=NOW)

    def test_refuses_business_scope_drift_or_prefunded_injection(self):
        original, prepared = fixture()
        prepared['background']['worker']['businessId'] = 'other'
        with self.assertRaises(Refused):
            build_interest_configuration(original, KEYS, prepared, now=NOW)
        original, prepared = fixture()
        original['prefundedReplay'] = {}
        with self.assertRaises(Refused):
            build_interest_configuration(original, KEYS, prepared, now=NOW)

    def test_refuses_invalid_signature_and_expired_renewal_without_mutating_inputs(self):
        original, prepared = fixture()
        for keys, now in (({**KEYS, 'appToken': 'wrong' * 8}, NOW), (KEYS, 1791302350)):
            with self.subTest(now=now), self.assertRaises(Refused):
                build_interest_configuration(original, keys, prepared, now=now)


if __name__ == '__main__':
    unittest.main()
