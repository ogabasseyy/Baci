import hashlib
import json
import unittest

from policy_test_fixture import policy_test_fixture
from verify_policy_candidate import verify_policy_candidate


NOW = '2026-10-02T11:00:00Z'


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.bundle, self.pins = policy_test_fixture()

    def verify(self):
        return verify_policy_candidate(self.bundle, self.pins, NOW)

    def change(self, kind, **values):
        record = next(item for item in self.bundle['evidence'] if item['kind'] == kind)
        record.update(values)
        self.pins[record['artifactId']]['sha256'] = hashlib.sha256(json.dumps(
            record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

    def test_accepts_exact_reviewed_attribution_as_inactive_only(self):
        report = self.verify()
        self.assertEqual(report['status'], 'prepared_inactive')
        policy = report['candidate']['policy']
        self.assertFalse(policy['enabled'])
        self.assertNotEqual(policy['interest_source_wallet_id'], policy['payout_wallet_id'])
        self.assertEqual(report['candidate']['principalKobo'], 10000)
        self.assertFalse(report['candidate']['pendingAccrualSpendable'])
        self.assertEqual(report['candidate']['customerNetTreatment'], 'full_customer_net_no_resplit')
        self.assertFalse(report['liveWritesAllowed'])

    def test_preparation_is_idempotent_when_evidence_order_changes(self):
        original = self.verify()
        self.bundle['evidence'].reverse()
        self.assertEqual(original, self.verify())

    def test_evidence_change_without_independent_pin_review_is_refused(self):
        self.bundle['evidence'][0]['apiCustomerId'] = 'another-customer-002'
        self.assertIn('registration_unreviewed_or_changed', self.verify()['refusals'])

    def test_returns_exact_machine_readable_missing_evidence(self):
        self.bundle['evidence'] = []
        report = self.verify()
        self.assertEqual(report['missingEvidence'], sorted({
            'wallet', 'wallet_eligibility', 'goal_binding', 'payout_routing', 'owner_opt_in', 'global_split',
            'customer_identity_one_complete_path'}))
        self.assertIsNone(report['candidate'])

    def test_refuses_historical_probe_third_party_identifier_as_app_owner(self):
        self.change('registration', thirdPartyIdentifier='baci-staging-probe')
        self.assertIn('registration_app_customer_unproven', self.verify()['refusals'])

    def test_does_not_equate_api_alias_and_webhook_uuid(self):
        self.change('customer_alias', webhookCustomerId='synthetic-api-001')
        self.assertIn('webhook_customer_exact_link_missing', self.verify()['refusals'])

    def test_does_not_strip_hyphens_from_opaque_ids(self):
        self.change('payout_routing', webhookCustomerId='a096507ddc3245d29c01871a27abfd10')
        self.assertIn('webhook_customer_exact_link_missing', self.verify()['refusals'])

    def test_empty_interest_true_wallet_cannot_replace_funded_goal_wallet(self):
        self.change('wallet', publicWalletId='synthetic-empty-interest-003')
        self.assertIn('goal_wallet_exact_link_missing', self.verify()['refusals'])

    def test_refuses_disabled_funded_wallet_even_with_global_rate_attestation(self):
        self.change('wallet', interestEnabled=False)
        self.assertIn('wallet_interest_not_enabled', self.verify()['refusals'])

    def test_refuses_guessed_source_equals_destination(self):
        self.change('payout_routing', sourceWalletId='synthetic-independent-destination-002')
        self.assertIn('payout_source_exact_mapping_missing', self.verify()['refusals'])

    def test_allows_equal_source_destination_only_with_explicit_reviewed_mapping(self):
        self.change('payout_routing', payoutWalletId='synthetic-faas-001')
        self.assertEqual(self.verify()['status'], 'prepared_inactive')

    def test_missing_owner_consent_or_split_cannot_prepare(self):
        for kind in ('owner_opt_in', 'global_split'):
            with self.subTest(kind=kind):
                bundle, pins = policy_test_fixture()
                bundle['evidence'] = [record for record in bundle['evidence'] if record['kind'] != kind]
                self.assertIn(kind, verify_policy_candidate(bundle, pins, NOW)['missingEvidence'])

    def test_refuses_unaccepted_owner_opt_in(self):
        self.change('owner_opt_in', accepted=False)
        self.assertIn('owner_opt_in_missing', self.verify()['refusals'])

    def test_refuses_resplitting_already_net_customer_interest(self):
        self.change('global_split', customerNetTreatment='multiply_net_by_75_percent')
        self.assertIn('global_split_attestation_invalid', self.verify()['refusals'])

    def test_refuses_other_business_or_production_evidence(self):
        for values in ({'environment': 'production'}, {'businessId': 'other-business-001'}):
            self.setUp()
            self.change('wallet', **values)
            self.assertIn('wallet_scope_mismatch', self.verify()['refusals'])

    def test_refuses_goal_customer_or_principal_mismatch(self):
        for values in ({'appCustomerId': 'other-app-customer'}, {'principalKobo': 10001},
                       {'bindingEnabled': False}):
            self.setUp()
            self.change('goal_binding', **values)
            self.assertEqual(self.verify()['status'], 'refused')

    def test_refuses_duplicate_or_ambiguous_evidence(self):
        self.bundle['evidence'].append(dict(self.bundle['evidence'][0]))
        self.assertIn('evidence_ambiguous', self.verify()['refusals'])

    def test_refuses_expired_or_future_observation(self):
        for values in ({'validUntil': NOW}, {'observedAt': '2026-10-03T00:00:00Z'}):
            self.setUp()
            self.change('wallet', **values)
            self.assertIn('wallet_validity_invalid', self.verify()['refusals'])

    def test_refuses_deadline_extension_and_expired_preparation(self):
        self.bundle['expiresAt'] = '2026-10-06T15:59:11Z'
        self.assertIn('deadline_invalid', self.verify()['refusals'])
        self.setUp()
        report = verify_policy_candidate(self.bundle, self.pins, self.bundle['expiresAt'])
        self.assertIn('deadline_invalid', report['refusals'])

    def test_rejects_invented_id_customer_requirement_and_raw_provider_fields(self):
        self.change('customer_alias', id_customer='invented-001')
        self.assertIn('evidence_schema_invalid', self.verify()['refusals'])
        self.assertNotIn('invented-001', json.dumps(self.verify()))

    def test_refuses_registry_kind_substitution(self):
        self.pins['synthetic-registration']['kind'] = 'wallet'
        self.assertIn('registration_unreviewed_or_changed', self.verify()['refusals'])

    def test_refuses_other_physical_app_database(self):
        self.change('goal_binding', systemIdentifier='7685292944002592803')
        self.assertIn('app_database_identity_mismatch', self.verify()['refusals'])

    def test_refuses_invalid_namespace_missing_destination_and_wrong_faas(self):
        for values in ({'sourceNamespace': 'guessed'}, {'payoutWalletId': None},
                       {'faasWalletId': 'unrelated-faas-002'}):
            self.setUp()
            self.change('payout_routing', **values)
            self.assertEqual(self.verify()['status'], 'refused')

    def test_refuses_invalid_input_and_registry_without_throwing(self):
        for bundle in (None, [], {}, {**self.bundle, 'scope': {}},
                       {**self.bundle, 'expiresAt': 123}):
            self.assertEqual(verify_policy_candidate(bundle, self.pins, NOW)['status'], 'refused')
        for pins in (None, [], {'id': {'kind': [], 'sha256': 'a' * 64}},
                     {'id': {'kind': 'wallet', 'sha256': 'invalid'}}):
            self.assertEqual(verify_policy_candidate(self.bundle, pins, NOW)['status'], 'refused')

    def test_interest_flag_and_global_rates_do_not_replace_individual_policy_eligibility(self):
        self.bundle['evidence'] = [record for record in self.bundle['evidence']
                                   if record['kind'] != 'wallet_eligibility']
        self.assertIn('wallet_eligibility', self.verify()['missingEvidence'])
        self.assertIsNone(self.verify()['candidate'])

    def test_refuses_unconfirmed_or_other_wallet_eligibility(self):
        for values in ({'eligibleForCustomerInterest': False}, {'faasWalletId': 'other-faas-002'}):
            self.setUp()
            self.change('wallet_eligibility', **values)
            self.assertIn('wallet_customer_interest_eligibility_unproven', self.verify()['refusals'])


if __name__ == '__main__':
    unittest.main()
