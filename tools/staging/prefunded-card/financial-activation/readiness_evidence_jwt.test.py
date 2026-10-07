import base64
import hashlib
import hmac
import json
import unittest

import readiness_evidence_jwt as jwt

NOW = 1790913600
KEYS = {name: 'synthetic-' + name + '-' * 40 for name in jwt.ROLES}
FACTORY = json.dumps({'scope': jwt.FACTORY_SCOPE, 'evidence': {},
    'database': {'treasury': {}, 'ingestion': {}}}, sort_keys=True, separators=(',', ':')).encode()


def token(name, changes=None):
    role, audience = jwt.ROLES[name]
    claims = {'role': role, 'aud': audience, 'iat': NOW - 1, 'exp': jwt.EPOCH, **(changes or {})}
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=')
    content = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode(claims)
    signature = hmac.new(KEYS[name].encode(), content, hashlib.sha256).digest()
    return (content + b'.' + base64.urlsafe_b64encode(signature).rstrip(b'=')).decode()


def configuration():
    return {'environment': 'staging', 'appSystemId': '7685292944002592802',
        'receiptSystemId': '7686901100561231906', 'receiptKey': base64.b64encode(b'k' * 32).decode(),
        **{name: token(name) for name in jwt.ROLES}, 'prefundedReplay': {
            'bundleSha256': jwt.FACTORY, 'configurationSha256': jwt.digest(FACTORY)}}


class JwtEvidenceTests(unittest.TestCase):
    def test_verifies_real_hmac_signatures_and_returns_no_tokens_or_keys(self):
        result = jwt.verify(configuration(), FACTORY, KEYS, NOW)
        self.assertTrue(result['jwtSignaturesVerified'])
        for secret in (*KEYS.values(), *[configuration()[name] for name in jwt.ROLES]):
            self.assertNotIn(secret, json.dumps(result))

    def test_refuses_signature_drift_audience_role_expiry_and_future_issue(self):
        for change in ({'role': 'service_role'}, {'aud': 'another'}, {'exp': jwt.EPOCH - 1},
                       {'iat': NOW + 1}, {'exp': True}):
            base = configuration()
            base['appToken'] = token('appToken', change)
            with self.subTest(change=change), self.assertRaises(jwt.Refused):
                jwt.verify(base, FACTORY, KEYS, NOW)
        with self.assertRaises(jwt.Refused):
            jwt.verify(configuration(), FACTORY, {**KEYS, 'appToken': 'wrong-' * 10}, NOW)

    def test_refuses_mixed_interest_only_mode_and_factory_pin_drift(self):
        with self.assertRaises(jwt.Refused):
            jwt.verify({**configuration(), 'financialDatabase': {}}, FACTORY, KEYS, NOW)
        with self.assertRaises(jwt.Refused):
            jwt.verify(configuration(), FACTORY + b' ', KEYS, NOW)

    def test_refuses_at_the_fixed_activation_cutoff(self):
        with self.assertRaisesRegex(jwt.Refused, 'window_expired'):
            jwt.verify(configuration(), FACTORY, KEYS, jwt.EPOCH - 600)

    def test_accepts_six_key_factory_without_expiry_and_never_injects_one(self):
        original = bytes(FACTORY)
        self.assertEqual(set(json.loads(FACTORY)['scope']), {
            'businessId', 'environment', 'expectedSystemId', 'integrationId', 'merchantId', 'treasuryBindingId'})
        self.assertNotIn(b'expiresAt', FACTORY)
        self.assertTrue(jwt.verify(configuration(), FACTORY, KEYS, NOW)['jwtSignaturesVerified'])
        self.assertEqual(FACTORY, original)
        self.assertEqual(configuration()['prefundedReplay']['configurationSha256'], jwt.digest(original))
        invalid = json.loads(FACTORY)
        invalid['scope']['expiresAt'] = jwt.DEADLINE
        changed = json.dumps(invalid).encode()
        base = configuration()
        base['prefundedReplay']['configurationSha256'] = jwt.digest(changed)
        with self.assertRaises(jwt.Refused):
            jwt.verify(base, changed, KEYS, NOW)


if __name__ == '__main__':
    unittest.main()
