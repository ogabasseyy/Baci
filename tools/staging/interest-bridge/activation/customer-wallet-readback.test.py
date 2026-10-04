import importlib.util
from pathlib import Path
import tempfile
import unittest


specification = importlib.util.spec_from_file_location('lookup', Path(__file__).with_name('customer-wallet-readback.py'))
lookup = importlib.util.module_from_spec(specification)
specification.loader.exec_module(lookup)


class CustomerReadbackTests(unittest.TestCase):
    def test_repeated_readback_retains_distinct_private_verified_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            for _ in range(2):
                provider = lookup.load_verified_provider(b'VERIFIED = True\n', directory)
                self.assertTrue(provider.VERIFIED)
            paths = list(Path(directory).glob('verified-provider-*.py'))
            self.assertEqual(len(paths), 2)
            self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in paths))

    def test_strips_names_email_and_credentials_from_customer_response(self):
        row = dict(id='opaque-id', customer_id='opaque-uuid', api_customer_id='opaque-api',
                   third_party_identifier=lookup.CUSTOMER, email='private@example.com',
                   first_name='private', secret='private')
        result = lookup.summarize(dict(edges=[row], pageInfo=dict(hasNextPage=False)))
        self.assertEqual(result[0]['id'], 'opaque-id')
        self.assertNotIn('email', result[0])
        self.assertNotIn('secret', result[0])

    def test_refuses_truncated_list_or_wrong_business(self):
        with self.assertRaises(ValueError):
            lookup.summarize(dict(edges=[], pageInfo=dict(hasNextPage=True)))
        with self.assertRaises(ValueError):
            lookup.summarize(dict(edges=[dict(business_id='another-business')],
                                  pageInfo=dict(hasNextPage=False)))


if __name__ == '__main__':
    unittest.main()
