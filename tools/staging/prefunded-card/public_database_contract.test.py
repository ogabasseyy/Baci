import unittest
from unittest.mock import patch

import public_database_contract as contract
from runtime_activation_sql import FUNCTIONS
from treasury_owner_contract import Refused


class DatabaseContractTests(unittest.TestCase):
    def test_read_only_exact_metadata_and_financial_baseline(self):
        with patch.object(contract, 'probe', return_value={'functions': True, 'scope': True, 'roles': True}) as probe:
            contract.verify_database()
        sql = probe.call_args.args[0]
        for signature, oid, _, desired, _ in FUNCTIONS:
            self.assertIn(signature, sql)
            self.assertIn(str(oid), sql)
            self.assertIn(desired, sql)
        for required in ('100.00', '10000', '1790697550', 'reserved_kobo=0', 'consumed_kobo=0',
                         'checkout_intents', 'credit_routes', 'rolvaliduntil', 'proacl', 'prosecdef'):
            self.assertIn(required, sql)
        for forbidden in ('ALTER ', 'INSERT ', 'UPDATE ', 'DELETE ', 'CREATE ', 'COMMIT;', 'LOCK TABLE'):
            self.assertNotIn(forbidden, sql)

    def test_no_coercion_of_missing_false_or_null_proof(self):
        for result in (None, {}, {'functions': True, 'scope': True, 'roles': None},
                       {'functions': True, 'scope': False, 'roles': True},
                       {'functions': 1, 'scope': True, 'roles': True}):
            with self.subTest(result=result), patch.object(contract, 'probe', return_value=result):
                with self.assertRaises(Refused):
                    contract.verify_database()


if __name__ == '__main__':
    unittest.main()
