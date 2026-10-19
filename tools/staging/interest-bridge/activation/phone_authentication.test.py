import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).parent))
import phone_authentication as authentication


class AuthenticationTests(unittest.TestCase):
    def inputs(self, path):
        if path == authentication.FIXTURE:
            return b'STAGING_PHONE_EMAIL=baci-staging@example.com\nSTAGING_PHONE_PASSWORD=private\n'
        return json.dumps(dict(mode='hosted-staging', apiOrigin=authentication.API,
            supabaseOrigin=authentication.AUTH, expectedAuthIssuer=authentication.AUTH + '/auth/v1',
            merchantId=authentication.MERCHANT, publicKey='fixture-key')).encode()

    def test_authenticates_only_exact_actor_using_the_pinned_profile(self):
        with patch.object(authentication, 'KEY_PIN', authentication.hashlib.sha256(b'fixture-key').hexdigest()):
            headers = authentication.authenticate(self.inputs, lambda *args: (200,
                dict(user=dict(id=authentication.ACTOR), access_token='fixture-session')))
        self.assertEqual(headers['Authorization'], 'Bearer fixture-session')

    def test_refuses_wrong_profile_before_authentication(self):
        called = []
        with self.assertRaisesRegex(ValueError, 'profile-refused'):
            authentication.authenticate(self.inputs, lambda *args: called.append(args))
        self.assertEqual(called, [])

    def test_refuses_foreign_actor_and_failed_authentication(self):
        with patch.object(authentication, 'KEY_PIN', authentication.hashlib.sha256(b'fixture-key').hexdigest()):
            for response in ((200, dict(user=dict(id='foreign'), access_token='private')),
                             (401, dict(user=dict(id=authentication.ACTOR), access_token='private'))):
                with self.subTest(response=response), self.assertRaises(ValueError):
                    authentication.authenticate(self.inputs, lambda *args: response)

    def test_denies_foreign_origin_or_credentials_before_http(self):
        for url in ('http://staging.ogabassey.com', 'https://api.paystack.co',
                    'https://private@staging.ogabassey.com', authentication.API + '/#private'):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, 'origin-refused'):
                authentication.request_json(url, {'Authorization': 'private'})


if __name__ == '__main__':
    unittest.main()
