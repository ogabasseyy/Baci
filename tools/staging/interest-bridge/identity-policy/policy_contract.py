import re


DEADLINE = '2026-10-06T15:59:10Z'
FUNDED_GOAL_WALLET = '01M3CQX27G9687EFSF1TKYMPR9'
SCOPE = {
    'environment': 'staging',
    'systemIdentifier': '7685292944002592802',
    'integrationId': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'merchantId': '10000000-0000-4000-8000-000000000001',
    'appCustomerId': '10000000-0000-4000-8000-000000000002',
    'goalId': '430314fd-cd8b-4579-98d4-e9f345713dd6',
    'businessId': '01M2381RG34HQJMHQKE7DWDACR',
}
FIELDS = {
    'registration': {'appCustomerId', 'apiCustomerId', 'thirdPartyIdentifier'},
    'customer_alias': {'apiCustomerId', 'webhookCustomerId'},
    'historical_receipt': {
        'systemIdentifier', 'integrationId', 'merchantId', 'appCustomerId', 'goalId',
        'historicalPublicWalletId', 'webhookCustomerId', 'amountKobo', 'currency',
        'eventId', 'providerTransactionId', 'payloadSha256', 'providerResponseSha256',
        'signatureStatus', 'originalPayloadIntegrity', 'reconciliationStatus',
        'historicalObservedAt', 'providerRetrievedAt', 'freshReconciliationStatus',
    },
    'historical_wallet': {'historicalPublicWalletId', 'apiCustomerId', 'currency', 'status'},
    'wallet': {'publicWalletId', 'faasWalletId', 'apiCustomerId', 'interestEnabled'},
    'wallet_eligibility': {'publicWalletId', 'faasWalletId', 'apiCustomerId',
                           'eligibleForCustomerInterest', 'eligibilityReference'},
    'goal_binding': {
        'integrationId', 'merchantId', 'appCustomerId', 'goalId',
        'publicWalletId', 'webhookCustomerId', 'principalKobo', 'bindingEnabled',
        'systemIdentifier',
    },
    'payout_routing': {
        'publicWalletId', 'faasWalletId', 'webhookCustomerId',
        'sourceWalletId', 'sourceNamespace', 'payoutWalletId',
    },
    'owner_opt_in': {
        'integrationId', 'merchantId', 'appCustomerId', 'goalId',
        'publicWalletId', 'accepted', 'policyReference',
    },
    'global_split': {
        'customerAnnualRateBps', 'businessAnnualRateBps', 'customerNetTreatment',
    },
}
PROVENANCE = {
    'registration': {'provider_registration_reconciliation'},
    'customer_alias': {'provider_documented_mapping', 'provider_signed_creation'},
    'historical_receipt': {'original_signature_and_provider_reconciliation',
                           'aead_original_and_provider_reconciliation'},
    'historical_wallet': {'provider_authenticated_readback'},
    'wallet': {'provider_authenticated_readback'},
    'wallet_eligibility': {'provider_documented_eligibility_confirmation'},
    'goal_binding': {'app_authenticated_snapshot'},
    'payout_routing': {'provider_documented_mapping', 'provider_signed_payout_mapping'},
    'owner_opt_in': {'owner_authenticated_attestation'},
    'global_split': {'owner_provider_contract_attestation'},
}
COMMON = {'kind', 'artifactId', 'provenance', 'environment', 'businessId',
          'observedAt', 'validUntil'}
BOOLEANS = {'interestEnabled', 'bindingEnabled', 'accepted', 'eligibleForCustomerInterest'}
INTEGERS = {'principalKobo', 'amountKobo', 'customerAnnualRateBps', 'businessAnnualRateBps'}
TOKEN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
SHA256 = re.compile(r'^[a-f0-9]{64}$')


def validate_evidence(record):
    if (not isinstance(record, dict) or not isinstance(record.get('kind'), str)
            or record['kind'] not in FIELDS):
        return False
    kind = record['kind']
    if set(record) != COMMON | FIELDS[kind]:
        return False
    if (not isinstance(record['provenance'], str)
            or record['provenance'] not in PROVENANCE[kind]):
        return False
    for field, value in record.items():
        if field in BOOLEANS:
            if type(value) is not bool:
                return False
        elif field in INTEGERS:
            if type(value) is not int or not 0 <= value <= 9007199254740991:
                return False
        elif not isinstance(value, str) or TOKEN.fullmatch(value) is None:
            return False
    return True
