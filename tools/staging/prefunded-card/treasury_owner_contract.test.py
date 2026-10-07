import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path


SPEC = importlib.util.spec_from_file_location('treasury_contract', Path(__file__).with_name('treasury_owner_contract.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TreasuryOwnerContract(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 27, 14, 0, tzinfo=timezone.utc)
        self.wallet = dict(id=MODULE.SOURCE, business_id=MODULE.BUSINESS, currency='NGN',
                           type='api', status='active', balance=10000, api_customer_id=None)

    def test_exact_separate_business_wallet(self):
        MODULE.validate_wallet(self.wallet)
        for changes in [dict(id='customer-wallet'), dict(business_id='foreign'), dict(currency='USD'),
                        dict(type='savings'), dict(status='closed'), dict(balance=10001), dict(balance=9999),
                        dict(balance=True), dict(api_customer_id='customer'), dict(customer_id='customer')]:
            with self.assertRaises(MODULE.Refused):
                MODULE.validate_wallet({**self.wallet, **changes})

    def test_scope_and_sql_escaping_are_pinned(self):
        value = MODULE.owner_input('p' * 64, self.now)
        self.assertEqual(value['openingAvailableKobo'], 10000)
        self.assertEqual(value['sourceWalletId'], MODULE.SOURCE)
        rendered = MODULE.render_candidate('BEGIN; __OWNER_INPUT__ __SNAPSHOT_SQL__ COMMIT;',
                                           'BEGIN; SELECT 1; COMMIT;', value, self.now)
        self.assertNotIn('__OWNER_INPUT__', rendered)
        self.assertEqual(rendered.count('COMMIT;'), 1)
        for changes in [dict(systemIdentifier='1'), dict(sourceWalletId='foreign'),
                        dict(expiresAt='2030-01-01T00:00:00Z'), dict(openingAvailableKobo=10001),
                        dict(verifierPassword="'; select 1; --"), dict(verifiedAt='2026-09-20T00:00:00Z'),
                        dict(extra='unexpected')]:
            with self.assertRaises(MODULE.Refused):
                MODULE.render_candidate('__OWNER_INPUT__ __SNAPSHOT_SQL__', 'BEGIN; SELECT 1; COMMIT;',
                                        {**value, **changes}, self.now)

    def test_lease_expiry_and_non_template_sql_refuse(self):
        with self.assertRaises(MODULE.Refused):
            MODULE.owner_input('p' * 64, datetime(2026, 9, 30, tzinfo=timezone.utc))
        value = MODULE.owner_input('p' * 64, self.now)
        for source, snapshot in [('SELECT 1;', 'BEGIN; COMMIT;'),
                                 ('__OWNER_INPUT__ __SNAPSHOT_SQL__', 'SELECT 1;'),
                                 ('__OWNER_INPUT__ __OWNER_INPUT__ __SNAPSHOT_SQL__', 'BEGIN; COMMIT;')]:
            with self.assertRaises(MODULE.Refused):
                MODULE.render_candidate(source, snapshot, value, self.now)


if __name__ == '__main__':
    unittest.main()
