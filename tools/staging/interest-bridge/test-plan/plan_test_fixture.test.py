import unittest
from datetime import datetime, timezone

from plan_contract import validate_approval
from plan_test_fixture import plan_test_fixture


class PlanFixtureTests(unittest.TestCase):
    def test_fixture_is_explicitly_synthetic_and_does_not_supply_a_real_payout_destination(self):
        approval, snapshot, wallet = plan_test_fixture()
        self.assertTrue(approval['routing']['payoutWalletId'].startswith('synthetic-'))
        payload = validate_approval(approval, snapshot, wallet, datetime.now(timezone.utc))
        self.assertEqual(payload['metadata']['prefundingKobo'], 0)
        self.assertNotEqual(approval['routing']['sourceWalletId'], approval['routing']['payoutWalletId'])


if __name__ == '__main__':
    unittest.main()
