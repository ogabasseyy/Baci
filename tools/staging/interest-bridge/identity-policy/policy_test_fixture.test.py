import unittest

from policy_test_fixture import policy_test_fixture
from verify_policy_candidate import verify_policy_candidate


class FixtureTests(unittest.TestCase):
    def test_fixture_has_exact_synthetic_attribution_and_independent_destination(self):
        bundle, pins = policy_test_fixture()
        report = verify_policy_candidate(bundle, pins, '2026-10-02T11:00:00Z')
        self.assertEqual(report['status'], 'prepared_inactive')
        self.assertTrue(report['candidate']['policy']['payout_wallet_id'].startswith('synthetic-'))

    def test_fixtures_do_not_share_mutable_state(self):
        original, _ = policy_test_fixture()
        changed, _ = policy_test_fixture()
        changed['scope']['goalId'] = 'modified'
        self.assertNotEqual(changed['scope'], original['scope'])


if __name__ == '__main__':
    unittest.main()
