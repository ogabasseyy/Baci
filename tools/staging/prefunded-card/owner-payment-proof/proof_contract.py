import hashlib
import json
from datetime import datetime, timezone


def reviewed_proof(value, expected):
    if set(value) != {'kind', 'verifiedAt', 'intent', 'collection', 'newPaymentStarted',
                      'paidAt', 'responseSha256', 'rawResponse'}:
        raise ValueError('owner_proof_shape')
    if (value['kind'] != 'independently-verified-test-collection' or value['intent'] != expected
            or value['newPaymentStarted'] is not False):
        raise ValueError('owner_proof_identity')
    raw = value['rawResponse'].encode('utf8')
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != value['responseSha256']:
        raise ValueError('owner_proof_bytes')
    response = json.loads(raw)
    data = response['data']
    collection = value['collection']
    authorization = collection['authorization']
    metadata = dict(transaction_type='prefunded_first_card', intent_id=expected['intentId'],
                    customer_id=expected['customerId'], merchant_id=expected['merchantId'],
                    integration_id=expected['integrationId'], goal_id=expected['goalId'],
                    request_fingerprint=expected['requestFingerprint'])
    if (response['status'] is not True or data['status'] != 'success' or data['domain'] != 'test'
            or data['channel'] != 'card' or data['authorization']['channel'] != 'card'
            or data['authorization']['reusable'] is not True
            or not all(data['metadata'].get(key) == value for key, value in metadata.items())
            or type(data['amount']) is not int or data['amount'] != expected['amountKobo']
            or data['currency'] != 'NGN' or data['reference'] != expected['reference']
            or data['customer']['email'] != expected['email']
            or str(data['id']) != collection['providerTransactionId']
            or data['customer']['customer_code'] != authorization['customerCode']
            or data['paidAt'] != value['paidAt']):
        raise ValueError('owner_proof_provider_identity')
    for source, target in (('authorization_code', 'authorizationCode'), ('signature', 'signature'),
                           ('brand', 'brand'), ('last4', 'last4'), ('exp_month', 'expiryMonth'),
                           ('exp_year', 'expiryYear')):
        if data['authorization'][source] != authorization[target]:
            raise ValueError('owner_proof_authorization')
    for key in ('paidAt', 'verifiedAt'):
        if not isinstance(value[key], str) or not value[key].endswith('Z'):
            raise ValueError('owner_proof_time')
    verified = datetime.fromisoformat(value['verifiedAt'].replace('Z', '+00:00'))
    paid = datetime.fromisoformat(value['paidAt'].replace('Z', '+00:00'))
    if paid > verified or not 0 <= (datetime.now(timezone.utc)-verified).total_seconds() <= 60:
        raise ValueError('owner_proof_stale')
    collection_digest = hashlib.sha256(json.dumps(collection, sort_keys=True, ensure_ascii=False,
        allow_nan=False, separators=(',', ':')).encode()).hexdigest()
    return dict(verifiedAt=value['verifiedAt'], paidAt=value['paidAt'], responseSha256=value['responseSha256'],
                collectionSha256=collection_digest, independentlyVerified=True,
                status='success', domain='test', channel='card', reusable=True)
