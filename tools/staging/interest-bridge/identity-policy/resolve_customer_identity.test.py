import unittest

from policy_contract import SCOPE
from resolve_customer_identity import resolve_customer_identity


def evidence():
    return {
        'historical_receipt': {
            **{key: SCOPE[key] for key in ('systemIdentifier', 'integrationId', 'merchantId', 'appCustomerId', 'goalId')},
            'historicalPublicWalletId': 'synthetic-old-wallet-001',
            'webhookCustomerId': 'synthetic-webhook-uuid-001', 'amountKobo': 10000,
            'currency': 'NGN', 'signatureStatus': 'unavailable',
            'provenance': 'aead_original_and_provider_reconciliation',
            'originalPayloadIntegrity': 'aead_authenticated',
            'reconciliationStatus': 'exact_provider_transaction_match',
            'payloadSha256': 'a' * 64, 'providerResponseSha256': 'b' * 64,
            'historicalObservedAt': '2026-09-27T11:26:02.580Z',
            'providerRetrievedAt': '2026-10-02T11:00:00Z', 'observedAt': '2026-10-02T11:00:00Z',
            'freshReconciliationStatus': 'exact_provider_transaction_identity_amount_match',
        },
        'historical_wallet': {'historicalPublicWalletId': 'synthetic-old-wallet-001',
                              'apiCustomerId': 'synthetic-api-001', 'currency': 'NGN', 'status': 'active'},
    }


class IdentityTests(unittest.TestCase):
    def test_exact_historical_public_wallet_join_needs_no_id_customer_field(self):
        identity, refusals = resolve_customer_identity(evidence())
        self.assertEqual(identity, {'apiCustomerId': 'synthetic-api-001',
                                    'webhookCustomerId': 'synthetic-webhook-uuid-001'})
        self.assertEqual(refusals, [])

    def test_original_signature_requires_verified_status(self):
        records = evidence()
        records['historical_receipt'].update(
            provenance='original_signature_and_provider_reconciliation', signatureStatus='verified')
        self.assertEqual(resolve_customer_identity(records)[1], [])
        records['historical_receipt']['signatureStatus'] = 'unavailable'
        self.assertIn('historical_receipt_authority_invalid', resolve_customer_identity(records)[1])

    def test_refuses_same_alias_when_historical_public_wallet_disagrees(self):
        records = evidence()
        records['historical_wallet']['historicalPublicWalletId'] = 'synthetic-other-wallet-002'
        identity, refusals = resolve_customer_identity(records)
        self.assertIsNone(identity)
        self.assertIn('historical_public_wallet_exact_join_missing', refusals)

    def test_refuses_storage_only_proof_missing_provider_reconciliation(self):
        records = evidence()
        records['historical_receipt']['reconciliationStatus'] = 'storage_only'
        self.assertIn('historical_receipt_authority_invalid', resolve_customer_identity(records)[1])

    def test_refuses_other_app_owner_or_physical_database(self):
        for key in ('appCustomerId', 'merchantId', 'goalId', 'systemIdentifier'):
            records = evidence()
            records['historical_receipt'][key] = 'unrelated'
            self.assertIn('historical_receipt_ownership_mismatch', resolve_customer_identity(records)[1])

    def test_refuses_conflicting_direct_and_historical_paths(self):
        records = evidence()
        records.update(registration={'appCustomerId': SCOPE['appCustomerId'],
                                     'thirdPartyIdentifier': SCOPE['appCustomerId'],
                                     'apiCustomerId': 'synthetic-other-api-002'},
                       customer_alias={'apiCustomerId': 'synthetic-other-api-002',
                                       'webhookCustomerId': 'synthetic-webhook-uuid-001'})
        self.assertIn('customer_identity_paths_conflict', resolve_customer_identity(records)[1])

    def test_does_not_refresh_historical_timestamp_without_fresh_provider_read(self):
        records = evidence()
        records['historical_receipt']['providerRetrievedAt'] = '2026-09-27T11:26:01Z'
        self.assertIn('historical_timestamp_provenance_invalid', resolve_customer_identity(records)[1])


if __name__ == '__main__':
    unittest.main()
