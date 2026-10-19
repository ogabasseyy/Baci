import base64
import copy
import hashlib
import hmac
import json
import unittest
from unittest.mock import patch

import replay_configuration as configuration
from runtime_replay_configuration import encode


class ReplayConfigurationTests(unittest.TestCase):
    def fixture(self):
        now = 1790910000
        keys = {'receiptToken': 'receipt-test-signing-key-' * 3, 'appToken': 'app-test-signing-key-' * 3}
        def token(name, role, audience):
            unsigned = b'.'.join((encode({'alg': 'HS256', 'typ': 'JWT'}),
                encode({'role': role, 'aud': audience, 'iat': now - 4 * 86400, 'exp': 1790697550})))
            signed = hmac.new(keys[name].encode(), unsigned, hashlib.sha256).digest()
            return (unsigned + b'.' + base64.urlsafe_b64encode(signed).rstrip(b'=')).decode()
        factory = json.dumps({'scope': configuration.APPROVED_SCOPE,
            'evidence': {'systemIdentifier': '7685292944002592802'},
            'database': {'ingestion': {'login': 'prefunded_evidence'},
                         'treasury': {'login': 'prefunded_treasury_operator'}}}).encode()
        base = {'environment': 'staging', 'receiptSystemId': '7686901100561231906',
            'appSystemId': '7685292944002592802', 'receiptKey': base64.b64encode(b'x' * 32).decode(),
            'receiptToken': token('receiptToken', 'pvb_staging_worker', 'pvb-staging-receipts'),
            'appToken': token('appToken', 'pvb_staging_app_worker', 'authenticated'),
            'prefundedReplay': {'bundleSha256': configuration.FACTORY,
                'configurationSha256': configuration.digest(factory)}}
        return base, factory, keys, now

    def test_preserves_prefunded_only_mode_and_issues_verified_exact_deadline_tokens(self):
        base, factory, keys, now = self.fixture()
        before = copy.deepcopy(base)
        with patch.object(configuration, 'CONFIGURATION_PREDECESSOR', configuration.digest(factory)):
            files = configuration.prepare_configuration(base, factory, keys, now)
        renewed = json.loads(files['config.json'])
        self.assertNotIn('financialDatabase', renewed)
        self.assertEqual(base, before)
        self.assertEqual(renewed['prefundedReplay']['configurationSha256'],
                         configuration.digest(files['prefunded.json']))
        self.assertEqual(files['prefunded.json'], factory)
        for name in keys:
            header, body, signature = renewed[name].split('.')
            claims = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
            self.assertEqual(claims['exp'], configuration.DEADLINE_EPOCH)
            expected = hmac.new(keys[name].encode(), (header + '.' + body).encode(), hashlib.sha256).digest()
            self.assertEqual(base64.urlsafe_b64decode(signature + '=' * (-len(signature) % 4)), expected)

    def test_actual_strict_replay_scope_without_expiry_is_preserved_not_fabricated(self):
        base, factory, keys, now = self.fixture()
        self.assertNotIn('expiresAt', json.loads(factory)['scope'])
        with patch.object(configuration, 'CONFIGURATION_PREDECESSOR', configuration.digest(factory)):
            files = configuration.prepare_configuration(base, factory, keys, now)
        self.assertEqual(files['prefunded.json'], factory)
        self.assertNotIn('expiresAt', json.loads(files['prefunded.json'])['scope'])

    def test_refuses_financial_database_mixed_with_prefunded_activation(self):
        base, factory, keys, now = self.fixture()
        base['financialDatabase'] = {'role': 'prefunded_treasury_operator'}
        with self.assertRaisesRegex(ValueError, 'financial_replay_base_scope_refused'):
            configuration.prepare_configuration(base, factory, keys, now)

    def test_refuses_invalid_signature_or_predecessor_config_without_issuing_tokens(self):
        base, factory, keys, now = self.fixture()
        with self.assertRaisesRegex(ValueError, 'financial_replay_configuration_predecessor_refused'):
            configuration.prepare_configuration(base, factory, keys, now)
        with patch.object(configuration, 'CONFIGURATION_PREDECESSOR', configuration.digest(factory)):
            keys['appToken'] = 'wrong-key-' * 5
            with self.assertRaisesRegex(ValueError, 'financial_replay_signature_proof_refused'):
                configuration.prepare_configuration(base, factory, keys, now)


if __name__ == '__main__':
    unittest.main()
