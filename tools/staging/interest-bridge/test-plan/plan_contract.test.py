import copy
import unittest
from datetime import datetime, timedelta, timezone

from plan_constants import OLD_WALLET, PLAN_KEY, SCOPE
from plan_contract import validate_approval
from plan_test_fixture import plan_test_fixture


class PlanContractTests(unittest.TestCase):
    def setUp(self):
        self.approval, self.snapshot, self.wallet = plan_test_fixture()
        self.now = datetime.now(timezone.utc)

    def run_contract(self):
        return validate_approval(self.approval, self.snapshot, self.wallet, self.now)

    def test_accepts_exact_opted_in_empty_wallet_and_independent_documented_payout(self):
        result = self.run_contract()
        self.assertEqual(result['planKey'], PLAN_KEY)
        self.assertEqual(result['sourceWalletId'], SCOPE['faasWalletId'])
        self.assertNotEqual(result['sourceWalletId'], result['payoutWalletId'])
        self.assertEqual(result['metadata']['prefundingKobo'], 0)
        self.assertTrue(result['metadata']['interestOptIn'])

    def test_goal_only_requires_absent_routing_and_still_validates_consent_and_split(self):
        self.approval['routing'] = None
        result = validate_approval(self.approval, self.snapshot, self.wallet, self.now, goal_only=True)
        self.assertTrue(result['goalOnly'])
        self.assertTrue(result['metadata']['interestOptIn'])
        self.assertNotIn('payoutWalletId', result)
        self.assertNotIn('sourceWalletId', result)
        with self.assertRaises(ValueError):
            self.run_contract()
        self.approval['optIn']['accepted'] = False
        with self.assertRaisesRegex(ValueError, 'owner-opt-in'):
            validate_approval(self.approval, self.snapshot, self.wallet, self.now, goal_only=True)
        self.approval['optIn']['accepted'] = True
        self.approval['split']['customerNetTreatment'] = 'resplit'
        with self.assertRaisesRegex(ValueError, 'business-global-split-unproven'):
            validate_approval(self.approval, self.snapshot, self.wallet, self.now, goal_only=True)

    def test_goal_only_refuses_placeholder_routing_even_if_disabled_or_unknown(self):
        for routing in ({}, {'enabled': False}, self.approval['routing']):
            self.approval['routing'] = routing
            with self.assertRaisesRegex(ValueError, 'goal-only-routing-must-be-absent'):
                validate_approval(self.approval, self.snapshot, self.wallet, self.now, goal_only=True)

    def test_does_not_guess_destination_from_source_or_accept_unreviewed_semantics(self):
        self.approval['routing']['payoutWalletId'] = SCOPE['faasWalletId']
        self.approval['routing']['destinationSemantics'] = 'guessed_same_as_source'
        with self.assertRaisesRegex(ValueError, 'namespace-unproven'):
            self.run_contract()

    def test_equal_source_and_destination_require_explicit_independent_routing_authority(self):
        self.approval['routing']['payoutWalletId'] = SCOPE['faasWalletId']
        self.assertEqual(self.run_contract()['payoutWalletId'], SCOPE['faasWalletId'])

    def test_payout_customer_namespace_is_documented_not_assumed_from_historical_bank_event(self):
        self.approval['routing'].update(providerCustomerNamespace='api', providerCustomerId=SCOPE['apiCustomerId'])
        self.assertEqual(self.run_contract()['payoutProviderCustomerId'], SCOPE['apiCustomerId'])
        self.approval['routing']['providerCustomerNamespace'] = 'webhook'
        with self.assertRaises(ValueError):
            self.run_contract()

    def test_refuses_remapping_old_goal_or_old_payout_wallet(self):
        self.approval['routing']['payoutWalletId'] = OLD_WALLET
        with self.assertRaises(ValueError):
            self.run_contract()
        self.approval, _, _ = plan_test_fixture()
        self.approval['scope']['publicWalletId'] = OLD_WALLET
        with self.assertRaises(ValueError):
            self.run_contract()

    def test_refuses_balance_bool_funding_and_interest_disabled(self):
        for field, value in (('balanceKobo', False), ('balanceKobo', 1), ('interestEnabled', False)):
            _, _, self.wallet = plan_test_fixture()
            self.wallet[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.run_contract()

    def test_refuses_missing_owner_consent_and_any_second_customer_split(self):
        for section, field, value in (
            ('optIn', 'accepted', False), ('optIn', 'termsAccepted', False),
            ('optIn', 'nonWithdrawableAccepted', False), ('optIn', 'interestEnabled', False),
            ('split', 'customerAnnualRateBps', 899), ('split', 'businessAnnualRateBps', 301),
            ('split', 'scope', 'per_wallet'), ('split', 'customerNetTreatment', 'resplit_75_percent'),
            ('eligibility', 'eligible', False), ('routing', 'sourceWalletId', SCOPE['publicWalletId'])):
            self.approval, _, _ = plan_test_fixture()
            self.approval[section][field] = value
            with self.subTest(section=section, field=field), self.assertRaises(ValueError):
                self.run_contract()

    def test_stale_future_or_expired_proof_refuses(self):
        for seconds in (-91, 1):
            self.wallet['retrievedAt'] = (self.now + timedelta(seconds=seconds)).isoformat().replace('+00:00', 'Z')
            with self.assertRaises(ValueError):
                self.run_contract()
        self.now = datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)
        with self.assertRaises(ValueError):
            self.run_contract()

    def test_current_snapshot_refresh_preserves_definition_idempotency(self):
        original = self.run_contract()
        self.approval['schemaMd5'] = self.snapshot['schemaMd5'] = 'c' * 32
        self.approval['stateMd5'] = self.snapshot['stateMd5'] = 'd' * 32
        refreshed = self.run_contract()
        self.assertEqual(original['metadata'], refreshed['metadata'])
        self.assertNotEqual(original['approvalSha256'], refreshed['approvalSha256'])
        self.approval['routing']['payoutWalletId'] = 'another-documented-destination'
        self.assertNotEqual(original['metadata'], self.run_contract()['metadata'])

    def test_schema_shape_mutations_and_alias_hyphen_stripping_are_not_accepted(self):
        for section in ('optIn', 'routing', 'eligibility', 'split'):
            original = copy.deepcopy(self.approval)
            self.approval[section] = {}
            with self.subTest(section=section), self.assertRaises(ValueError):
                self.run_contract()
            self.approval = original
        self.approval['scope']['webhookCustomerId'] = SCOPE['webhookCustomerId'].replace('-', '')
        with self.assertRaises(ValueError):
            self.run_contract()


if __name__ == '__main__':
    unittest.main()
