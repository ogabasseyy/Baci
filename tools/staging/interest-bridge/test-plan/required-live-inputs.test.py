from pathlib import Path
import unittest


class RequiredLiveInputsContractTests(unittest.TestCase):
    def test_root_query_is_transaction_read_only_and_excludes_secret_and_provider_payload_columns(self):
        query = Path(__file__).with_name('required-live-inputs.sql').read_text()
        self.assertTrue(query.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
        self.assertTrue(query.endswith('ROLLBACK;\n'))
        for forbidden in ('INSERT ', 'UPDATE ', 'DELETE ', 'rolpassword', 'encrypted_password',
                          'raw_body', 'signature_secret', 'apiSecret'):
            self.assertNotIn(forbidden, query)
        self.assertIn('create_customer_savings_goal', query)
        self.assertIn('ownerMatches', query)


if __name__ == '__main__':
    unittest.main()
