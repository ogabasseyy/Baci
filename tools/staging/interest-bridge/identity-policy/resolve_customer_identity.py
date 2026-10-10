from datetime import datetime

from policy_contract import SCOPE, SHA256


def resolve_customer_identity(by_kind):
    identities = []
    refusals = []
    registration, alias = by_kind.get('registration'), by_kind.get('customer_alias')
    receipt, historical_wallet = by_kind.get('historical_receipt'), by_kind.get('historical_wallet')
    if registration is not None and alias is not None:
        if (registration['appCustomerId'] != SCOPE['appCustomerId']
                or registration['thirdPartyIdentifier'] != SCOPE['appCustomerId']):
            refusals.append('registration_app_customer_unproven')
        if registration['apiCustomerId'] != alias['apiCustomerId']:
            refusals.append('api_customer_exact_link_missing')
        identities.append((alias['apiCustomerId'], alias['webhookCustomerId']))
    if receipt is not None and historical_wallet is not None:
        if any(receipt[key] != SCOPE[key] for key in
               ('systemIdentifier', 'integrationId', 'merchantId', 'appCustomerId', 'goalId')):
            refusals.append('historical_receipt_ownership_mismatch')
        if receipt['historicalPublicWalletId'] != historical_wallet['historicalPublicWalletId']:
            refusals.append('historical_public_wallet_exact_join_missing')
        signature = {
            'original_signature_and_provider_reconciliation': 'verified',
            'aead_original_and_provider_reconciliation': 'unavailable',
        }[receipt['provenance']]
        if (receipt['amountKobo'] != 10000 or receipt['currency'] != 'NGN'
                or historical_wallet['currency'] != 'NGN' or historical_wallet['status'] != 'active'
                or receipt['signatureStatus'] != signature
                or receipt['originalPayloadIntegrity'] != 'aead_authenticated'
                or receipt['reconciliationStatus'] != 'exact_provider_transaction_match'
                or SHA256.fullmatch(receipt['payloadSha256']) is None
                or SHA256.fullmatch(receipt['providerResponseSha256']) is None):
            refusals.append('historical_receipt_authority_invalid')
        try:
            historical_at = datetime.fromisoformat(receipt['historicalObservedAt'].replace('Z', '+00:00'))
            provider_at = datetime.fromisoformat(receipt['providerRetrievedAt'].replace('Z', '+00:00'))
            if (historical_at.tzinfo is None or provider_at.tzinfo is None
                    or historical_at > provider_at or receipt['providerRetrievedAt'] != receipt['observedAt']
                    or receipt['freshReconciliationStatus'] not in (
                        'exact_provider_transaction_match', 'exact_provider_transaction_identity_amount_match')):
                raise ValueError('historical-time')
        except (ValueError, TypeError, KeyError):
            refusals.append('historical_timestamp_provenance_invalid')
        identities.append((historical_wallet['apiCustomerId'], receipt['webhookCustomerId']))
    if not identities:
        return None, ['customer_identity_path_incomplete']
    if len(set(identities)) != 1:
        refusals.append('customer_identity_paths_conflict')
    if refusals:
        return None, refusals
    api_customer, webhook_customer = identities[0]
    return {'apiCustomerId': api_customer, 'webhookCustomerId': webhook_customer}, []
