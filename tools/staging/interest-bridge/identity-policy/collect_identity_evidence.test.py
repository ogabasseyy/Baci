import copy
import hashlib
import json
import unittest

from collect_identity_evidence import OLD_WALLET, READ_ONLY_SQL, TRUE_WALLET, collect_identity_evidence
from policy_contract import SCOPE
from policy_test_fixture import policy_test_fixture
from resolve_customer_identity import resolve_customer_identity
from verify_policy_candidate import verify_policy_candidate


NOW = '2026-10-02T11:00:00Z'


class CollectorTests(unittest.TestCase):
    def setUp(self):
        scope = {key: SCOPE[key] for key in
                 ('systemIdentifier', 'integrationId', 'businessId', 'merchantId', 'goalId')}
        scope.update(customerId=SCOPE['appCustomerId'], providerWalletId=OLD_WALLET,
                     providerCustomerId='c096507d-dc32-45d2-9c01-871a27abfd10', currency='NGN')
        self.history = {'changesMade': False, 'principalKobo': 10000, 'ownerSealed': {
            'scope': scope, 'verifiedAt': '2026-09-27T11:26:02.580Z', 'credits': [{
                'observation': {'status': 'verified', 'kind': 'bank_inflow',
                                'destinationWalletId': OLD_WALLET,
                                'destinationCustomerId': scope['providerCustomerId'],
                                'amountKobo': 10000, 'currency': 'NGN', 'eventId': 'synthetic-event-001',
                                'providerTransactionId': 'synthetic-transaction-001'},
                'providerReconciliation': {'transactionId': 'synthetic-transaction-001',
                                           'responseSha256': 'a' * 64},
                'payloadSha256': 'b' * 64, 'originalPayloadIntegrity': 'aead_authenticated',
                'provenance': 'provider_reconciliation', 'signatureStatus': 'unavailable',
            }]}}
        self.wallets = {wallet: {'id': wallet, 'api_customer_id': 'synthetic-api-001',
                                 'business_id': SCOPE['businessId'], 'faas_wallet_identifier': 'synthetic-faas-' + wallet,
                                 'currency': 'NGN', 'status': 'active', 'interest_enabled': wallet == TRUE_WALLET,
                                 'provider_payload': 'SECRET-BODY-DO-NOT-EMIT'}
                        for wallet in (OLD_WALLET, TRUE_WALLET)}
        self.binding = {key: SCOPE[key] for key in
                        ('systemIdentifier', 'integrationId', 'merchantId', 'appCustomerId', 'goalId')}
        self.binding.update(publicWalletId=OLD_WALLET, webhookCustomerId=scope['providerCustomerId'],
                            principalKobo=10000, bindingEnabled=True)
        self.fresh = {'transactionId': 'synthetic-transaction-001',
                      'status': 'exact_provider_transaction_match', 'retrievedAt': NOW,
                      'responseSha256': 'c' * 64}

    def collect(self):
        return collect_identity_evidence(self.history, self.wallets, self.binding, NOW, self.fresh)

    def test_collects_historical_join_without_inventing_signature_or_emitting_provider_body(self):
        bundle = self.collect()
        records = {record['kind']: record for record in bundle['evidence']}
        self.assertEqual(resolve_customer_identity(records)[0]['apiCustomerId'], 'synthetic-api-001')
        self.assertEqual(records['historical_receipt']['signatureStatus'], 'unavailable')
        self.assertNotIn('SECRET-BODY', json.dumps(bundle))
        self.assertEqual(records['historical_receipt']['historicalObservedAt'], '2026-09-27T11:26:02.580Z')

    def test_other_true_wallet_requires_a_separate_new_goal_even_with_payout_contract(self):
        collected = self.collect()
        bundle, _ = policy_test_fixture()
        bundle['evidence'] = [record for record in bundle['evidence']
                              if record['kind'] not in ('registration', 'customer_alias', 'wallet', 'goal_binding')]
        bundle['evidence'].extend(collected['evidence'])
        for record in bundle['evidence']:
            if record['kind'] in ('goal_binding', 'owner_opt_in', 'payout_routing', 'wallet_eligibility'):
                record['publicWalletId'] = TRUE_WALLET
            if record['kind'] in ('payout_routing', 'wallet_eligibility'):
                record['faasWalletId'] = self.wallets[TRUE_WALLET]['faas_wallet_identifier']
            if record['kind'] == 'payout_routing':
                record['sourceWalletId'] = record['faasWalletId']
            if 'webhookCustomerId' in record:
                record['webhookCustomerId'] = self.binding['webhookCustomerId']
        pins = {record['artifactId']: {'kind': record['kind'], 'sha256': hashlib.sha256(
            json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
                for record in bundle['evidence']}
        self.assertIn('new_goal_and_provisioned_binding_required',
                      verify_policy_candidate(bundle, pins, NOW)['refusals'])

    def test_historical_owner_join_does_not_authorize_replacing_old_goal_wallet(self):
        collected = self.collect()
        pins = {record['artifactId']: {'kind': record['kind'], 'sha256': hashlib.sha256(
            json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
                for record in collected['evidence']}
        report = verify_policy_candidate(collected, pins, NOW)
        self.assertEqual(report['status'], 'refused')
        self.assertIsNone(report['candidate'])
        self.assertNotIn('customer_identity_one_complete_path', report['missingEvidence'])
        self.assertIn('payout_routing', report['missingEvidence'])
        self.assertIn('goal_wallet_exact_link_missing', report['refusals'])

    def test_refuses_other_business_public_wallet_customer_or_mismatched_reconciliation(self):
        original_wallets = copy.deepcopy(self.wallets)
        for key, value in (('id', 'another-wallet'), ('business_id', 'another-business'),
                           ('api_customer_id', 'another-customer')):
            self.wallets = copy.deepcopy(original_wallets)
            self.wallets[OLD_WALLET][key] = value
            with self.assertRaises(ValueError):
                self.collect()
        self.wallets = original_wallets
        self.history['ownerSealed']['credits'][0]['providerReconciliation']['transactionId'] = 'wrong-tx'
        with self.assertRaises(ValueError):
            self.collect()

    def test_refuses_unknown_app_projection_fields_and_claimed_original_signature(self):
        self.binding['secret'] = 'DO-NOT-EMIT'
        with self.assertRaises(ValueError):
            self.collect()
        del self.binding['secret']
        self.history['ownerSealed']['credits'][0]['signatureStatus'] = 'verified'
        with self.assertRaises(ValueError):
            self.collect()

    def test_root_query_is_rollback_read_only_and_has_no_locks_or_writes(self):
        self.assertIn('READ ONLY', READ_ONLY_SQL)
        self.assertIn('ROLLBACK;', READ_ONLY_SQL)
        for forbidden in ('INSERT ', 'UPDATE ', 'DELETE ', 'FOR UPDATE', 'CREATE ', 'ALTER '):
            self.assertNotIn(forbidden, READ_ONLY_SQL)

    def test_refuses_timestamp_refresh_without_fresh_provider_reconciliation(self):
        self.fresh['retrievedAt'] = '2026-09-27T11:26:01Z'
        with self.assertRaisesRegex(ValueError, 'fresh-reconciliation'):
            self.collect()


if __name__ == '__main__':
    unittest.main()
