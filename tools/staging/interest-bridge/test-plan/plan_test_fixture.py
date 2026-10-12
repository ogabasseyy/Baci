from datetime import datetime, timezone

from plan_constants import DEADLINE, IDENTITY_SHA, SCOPE


def plan_test_fixture():
    observed = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    snapshot = {'systemIdentifier': SCOPE['systemIdentifier'], 'observedAt': observed,
                'schemaMd5': 'a' * 32, 'stateMd5': 'b' * 32}
    wallet = {'scope': dict(SCOPE), 'retrievedAt': observed, 'responseSha256': 'c' * 64,
              'interestEnabled': True, 'balanceKobo': 0, 'withdrawalCount': 0}
    approval = {
        'scope': dict(SCOPE), 'expiresAt': DEADLINE, 'identitySha256': IDENTITY_SHA,
        'schemaMd5': snapshot['schemaMd5'], 'stateMd5': snapshot['stateMd5'],
        'snapshotObservedAt': observed,
        'optIn': {'accepted': True, 'interestEnabled': True, 'termsAccepted': True,
                  'nonWithdrawableAccepted': True, 'acceptedAt': observed, 'reference': 'synthetic-opt-in'},
        'routing': {'provenance': 'provider_documented_mapping', 'artifactSha256': 'd' * 64,
                    'reference': 'synthetic-routing', 'sourceNamespace': 'faas',
                    'sourceWalletId': SCOPE['faasWalletId'], 'destinationNamespace': 'faas',
                    'payoutWalletId': 'synthetic-independent-payout-wallet',
                    'sourceSemantics': 'interest_earning_wallet',
                    'destinationSemantics': 'customer_net_payout_wallet',
                    'providerCustomerNamespace': 'webhook', 'providerCustomerId': SCOPE['webhookCustomerId']},
        'eligibility': {'eligible': True, 'provenance': 'provider_authenticated_wallet_get',
                        'artifactSha256': 'e' * 64, 'reference': 'synthetic-eligibility'},
        'split': {'scope': 'business_global', 'customerAnnualRateBps': 900,
                  'businessAnnualRateBps': 300, 'customerNetTreatment': 'full_customer_net_no_resplit',
                  'provenance': 'user_forwarded_provider_confirmation',
                  'artifactSha256': 'f' * 64, 'reference': 'synthetic-business-contract'},
    }
    return approval, snapshot, wallet
