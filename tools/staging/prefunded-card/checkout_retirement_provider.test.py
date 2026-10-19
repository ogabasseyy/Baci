import io
import json
import unittest
import urllib.error

import checkout_retirement_provider as provider
from treasury_owner_contract import Refused


class ProviderTests(unittest.TestCase):
    def test_accepts_only_exact_not_found_and_never_calls_it_failed(self):
        for message in ('Transaction reference not found', 'Transaction reference not found.'):
            provider.classify_not_found(400, json.dumps(dict(status=False, message=message)).encode())
        for status, body in ((200, dict(status=True)), (401, dict(status=False)), (400, dict(status=False, message='secret')),
                             (400, dict(status=True, message='Transaction reference not found')),
                             (400, dict(status=False, message='Transaction reference not found', data={'status': 'success'})),
                             (400, dict(status=False, message='Transaction reference not found', code='invalid_key'))):
            with self.assertRaises(Refused):
                provider.classify_not_found(status, json.dumps(body).encode())

    def test_makes_only_get_on_original_reference_and_redacts_response(self):
        class Opener:
            def open(self, request, timeout):
                self.request = request
                body = json.dumps(dict(status=False, message='Transaction reference not found', private='never return')).encode()
                raise urllib.error.HTTPError(request.full_url, 400, 'private', {}, io.BytesIO(body))
        opener = Opener()
        result = provider.verify_unconfirmed('sk_test_fixture', 'a' * 64, opener)
        self.assertEqual(opener.request.method, 'GET')
        self.assertTrue(opener.request.full_url.endswith(provider.REFERENCE))
        self.assertIsNone(opener.request.data)
        self.assertEqual(result['providerResult'], 'transaction_not_found')
        self.assertNotIn('private', json.dumps(result))
        self.assertNotIn('sk_test', json.dumps(result))

    def test_live_key_network_errors_and_oversized_responses_refuse(self):
        with self.assertRaises(Refused):
            provider.verify_unconfirmed('sk_live_fixture', 'a' * 64)
        class Opener:
            def open(self, request, timeout):
                raise TimeoutError('private network data')
        with self.assertRaises(TimeoutError):
            provider.verify_unconfirmed('sk_test_fixture', 'a' * 64, Opener())
        class Oversized:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, 400, 'private', {}, io.BytesIO(b'x' * 32769))
        with self.assertRaises(Refused):
            provider.verify_unconfirmed('sk_test_fixture', 'a' * 64, Oversized())

    def test_refuses_redirect(self):
        self.assertIsNone(provider.NoRedirects().redirect_request(None, None, 302, '', {}, 'https://other.example'))


if __name__ == '__main__':
    unittest.main()
