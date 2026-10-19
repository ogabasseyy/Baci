import hashlib
import json

from policy_contract import DEADLINE, FUNDED_GOAL_WALLET, SCOPE


def policy_test_fixture():
    data = {
        'registration': {
            'appCustomerId': SCOPE['appCustomerId'], 'apiCustomerId': 'synthetic-api-001',
            'thirdPartyIdentifier': SCOPE['appCustomerId'],
        },
        'customer_alias': {'apiCustomerId': 'synthetic-api-001',
                           'webhookCustomerId': 'a096507d-dc32-45d2-9c01-871a27abfd10'},
        'wallet': {'publicWalletId': 'synthetic-public-001', 'faasWalletId': 'synthetic-faas-001',
                   'apiCustomerId': 'synthetic-api-001', 'interestEnabled': True},
        'goal_binding': {key: SCOPE[key] for key in
                         ('integrationId', 'merchantId', 'appCustomerId', 'goalId')},
        'payout_routing': {
            'publicWalletId': 'synthetic-public-001', 'faasWalletId': 'synthetic-faas-001',
            'webhookCustomerId': 'a096507d-dc32-45d2-9c01-871a27abfd10',
            'sourceWalletId': 'synthetic-faas-001', 'sourceNamespace': 'faas',
            'payoutWalletId': 'synthetic-independent-destination-002',
        },
        'owner_opt_in': {key: SCOPE[key] for key in
                         ('integrationId', 'merchantId', 'appCustomerId', 'goalId')},
        'global_split': {'customerAnnualRateBps': 900, 'businessAnnualRateBps': 300,
                         'customerNetTreatment': 'full_customer_net_no_resplit'},
    }
    data['goal_binding'].update(publicWalletId='synthetic-public-001',
                               webhookCustomerId='a096507d-dc32-45d2-9c01-871a27abfd10',
                               principalKobo=10000, bindingEnabled=True,
                               systemIdentifier=SCOPE['systemIdentifier'])
    data['owner_opt_in'].update(publicWalletId='synthetic-public-001', accepted=True,
                               policyReference='synthetic-owner-consent-001')
    provenances = ('provider_registration_reconciliation', 'provider_documented_mapping',
                   'provider_authenticated_readback', 'app_authenticated_snapshot',
                   'provider_documented_mapping', 'owner_authenticated_attestation',
                   'owner_provider_contract_attestation')
    records = [{**values, 'kind': kind, 'artifactId': 'synthetic-' + kind,
                'provenance': provenance, 'environment': 'staging', 'businessId': SCOPE['businessId'],
                'observedAt': '2026-10-02T10:00:00Z', 'validUntil': DEADLINE}
               for (kind, values), provenance in zip(data.items(), provenances)]
    pins = {record['artifactId']: {
        'kind': record['kind'],
        'sha256': hashlib.sha256(json.dumps(record, sort_keys=True,
                                           separators=(',', ':')).encode()).hexdigest(),
    } for record in records}
    eligibility = {
        'publicWalletId': 'synthetic-public-001', 'faasWalletId': 'synthetic-faas-001',
        'apiCustomerId': 'synthetic-api-001', 'eligibleForCustomerInterest': True,
        'eligibilityReference': 'synthetic-provider-eligibility-001', 'kind': 'wallet_eligibility',
        'artifactId': 'synthetic-wallet-eligibility', 'provenance': 'provider_documented_eligibility_confirmation',
        'environment': 'staging', 'businessId': SCOPE['businessId'],
        'observedAt': '2026-10-02T10:00:00Z', 'validUntil': DEADLINE,
    }
    records.append(eligibility)
    for record in records:
        if 'publicWalletId' in record:
            record['publicWalletId'] = FUNDED_GOAL_WALLET
        pins[record['artifactId']] = {'kind': record['kind'], 'sha256': hashlib.sha256(
            json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
    pins[eligibility['artifactId']] = {'kind': eligibility['kind'], 'sha256': hashlib.sha256(
        json.dumps(eligibility, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
    return {'scope': dict(SCOPE), 'expiresAt': DEADLINE, 'evidence': records}, pins
