import base64
import hashlib
import hmac
import json
import unittest
from runtime_replay_configuration import prepare_replay_configuration
from treasury_owner_contract import DEADLINE_EPOCH, Refused, SYSTEM


NOW = 1790523000
KEYS = {'receiptToken': 'r' * 40, 'appToken': 'a' * 40}
ROLES = {'receiptToken': ('pvb_staging_worker', 'pvb-staging-receipts'),
         'appToken': ('pvb_staging_app_worker', 'authenticated')}


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')


def token(name, role=None):
    expected_role, audience = ROLES[name]
    body = b'.'.join((encode({'alg': 'HS256', 'typ': 'JWT'}), encode({
        'role': role or expected_role, 'aud': audience, 'iat': NOW - 604800, 'exp': NOW - 1})))
    signature = hmac.new(KEYS[name].encode(), body, hashlib.sha256).digest()
    return (body + b'.' + base64.urlsafe_b64encode(signature).rstrip(b'=')).decode()


def configuration():
    return {'environment': 'staging', 'receiptSystemId': '7686901100561231906',
            'appSystemId': SYSTEM, 'receiptKey': base64.b64encode(b'x' * 32).decode(),
            **{name: token(name) for name in ROLES}}


class RuntimeReplayConfigurationTests(unittest.TestCase):
    def test_reviewed_renewal_uses_its_explicit_deadline_without_changing_the_default(self):
        original = configuration()
        renewed = prepare_replay_configuration(original, KEYS, original['receiptKey'],
                                               now=1790841600, deadline=1791302350)
        for name in ROLES:
            claims = json.loads(base64.urlsafe_b64decode(renewed[name].split('.')[1] + '==='))
            self.assertEqual(claims['exp'], 1791302350)
            self.assertEqual(claims['iat'], 1790841600)
        with self.assertRaises(Refused):
            prepare_replay_configuration(original, KEYS, original['receiptKey'], now=1790841600)

    def test_expired_verified_tokens_are_replaced_without_extending_approval(self):
        original = configuration()
        prepared = prepare_replay_configuration(original, KEYS, original['receiptKey'], now=NOW)
        self.assertEqual(original, configuration())
        for name, (role, audience) in ROLES.items():
            header, body, signature = prepared[name].split('.')
            claims = json.loads(base64.urlsafe_b64decode(body + '==='))
            self.assertEqual(claims, {'role': role, 'aud': audience, 'iat': NOW, 'exp': DEADLINE_EPOCH})
            expected = hmac.new(KEYS[name].encode(), (header + '.' + body).encode(), hashlib.sha256).digest()
            self.assertEqual(base64.urlsafe_b64decode(signature + '==='), expected)
        self.assertEqual(prepared['receiptKey'], original['receiptKey'])

    def test_refuses_wrong_signing_key_or_role(self):
        original = configuration()
        with self.assertRaises(Refused):
            prepare_replay_configuration(original, {**KEYS, 'appToken': 'wrong' * 8}, original['receiptKey'], now=NOW)
        original['appToken'] = token('appToken', 'service_role')
        with self.assertRaises(Refused):
            prepare_replay_configuration(original, KEYS, original['receiptKey'], now=NOW)

    def test_verified_unexpired_preparation_can_be_repeated_without_extending_deadline(self):
        original = configuration()
        prepared = prepare_replay_configuration(original, KEYS, original['receiptKey'], now=NOW)
        retried = prepare_replay_configuration(prepared, KEYS, original['receiptKey'], now=NOW + 60)
        for name in ROLES:
            claims = json.loads(base64.urlsafe_b64decode(retried[name].split('.')[1] + '==='))
            self.assertEqual(claims['exp'], DEADLINE_EPOCH)
            self.assertEqual(claims['iat'], NOW + 60)

    def test_refuses_wrong_receipt_key_system_unknown_fields_or_noncanonical_jwt(self):
        original = configuration()
        for overrides in ({'appSystemId': '123'}, {'financialDatabase': {}},
                          {'receiptKey': base64.b64encode(b'y' * 32).decode()},
                          {'appToken': original['appToken'] + '='}):
            with self.subTest(fields=list(overrides)), self.assertRaises(Refused):
                prepare_replay_configuration({**original, **overrides}, KEYS, original['receiptKey'], now=NOW)

    def test_refuses_expired_or_over_seven_day_window(self):
        original = configuration()
        for now in (DEADLINE_EPOCH, DEADLINE_EPOCH - 179, DEADLINE_EPOCH - 604801, True):
            with self.subTest(now=now), self.assertRaises(Refused):
                prepare_replay_configuration(original, KEYS, original['receiptKey'], now=now)


if __name__ == '__main__':
    unittest.main()
