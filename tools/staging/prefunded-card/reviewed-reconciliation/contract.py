import hashlib
import json
import re
from datetime import datetime, timezone


SOURCE_SHA256 = 'e078268766bdac768b934ff8428be005c6060c89fbeec1bd55c4a6f1c80b7c7f'
INTENT = 'ff561046-58e7-428d-9163-f6e60b0dab65'
GOAL = '9f01153c-1589-4dde-b9aa-8f644a846832'
OLD_GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
DEADLINE = '2026-10-06T15:59:10Z'
SCOPE = dict(deployment='staging', integrationId='d91d9e87-8e0d-44de-9b84-1e1d709633d2',
             merchantId='10000000-0000-4000-8000-000000000001',
             treasuryBindingId='ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
             businessId='01M2381RG34HQJMHQKE7DWDACR',
             systemIdentifier='7685292944002592802', expiresAt=DEADLINE)
SELECTION = dict(intentId=INTENT, customerId='10000000-0000-4000-8000-000000000002',
                 actorId='baeb4f5a-54c7-4d46-8b07-9e69ab2907b3', goalId=GOAL)


def sha256(value):
    return hashlib.sha256(value.encode()).hexdigest()


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                             separators=(',', ':')))


def require(condition, code):
    if not condition:
        raise ValueError(code)


def hex_digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def timestamp(value):
    require(isinstance(value, str) and value.endswith('Z'), 'timestamp')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def validate(bundle, reviewed_sha256):
    now = datetime.now(timezone.utc)
    require(hex_digest(reviewed_sha256) and digest(bundle) == reviewed_sha256, 'reviewed_bundle_pin')
    require(set(bundle) == {'source', 'scope', 'selection', 'collection', 'preflight', 'proof'}, 'bundle_shape')
    require(now < timestamp(DEADLINE), 'deadline')
    require(bundle['scope'] == SCOPE and bundle['selection'] == SELECTION, 'exact_scope')
    require(isinstance(bundle['source'], str) and sha256(bundle['source']) == SOURCE_SHA256, 'original_source_pin')
    collection = bundle['collection']
    require(isinstance(collection, dict) and set(collection) == {
        'intentId', 'reference', 'providerTransactionId', 'amountKobo', 'currency', 'domain', 'authorization'},
        'collection_shape')
    require(collection['intentId'] == INTENT and collection['reference'] == 'pvb-first-' + INTENT
            and type(collection['amountKobo']) is int and collection['amountKobo'] == 10000
            and collection['currency'] == 'NGN' and collection['domain'] == 'test', 'collection_identity')
    require(isinstance(collection['providerTransactionId'], str)
            and re.fullmatch('[1-9][0-9]{0,19}', collection['providerTransactionId'])
            and int(collection['providerTransactionId']) <= 18446744073709551615, 'provider_transaction')
    authorization = collection['authorization']
    require(isinstance(authorization, dict) and set(authorization) == {
        'authorizationCode', 'signature', 'customerCode', 'email', 'reusable', 'brand', 'last4',
        'expiryMonth', 'expiryYear'}, 'authorization_shape')
    require(authorization['reusable'] is True and all(isinstance(value, str)
            for key, value in authorization.items() if key != 'reusable'), 'authorization_types')
    patterns = dict(authorizationCode=r'AUTH_[A-Za-z0-9_]+', customerCode=r'CUS_[A-Za-z0-9_]+',
                    last4=r'[0-9]{4}', expiryMonth=r'0?[1-9]|1[0-2]', expiryYear=r'[0-9]{4}',
                    email=r'[^\s@]+@[^\s@]+\.[^\s@]+', signature=r'[^\s\x00-\x1f\x7f]+')
    require(all(re.fullmatch(pattern, authorization[key]) for key, pattern in patterns.items())
            and all(1 <= len(authorization[key].encode()) <= 512
                    for key in ('authorizationCode', 'signature', 'customerCode'))
            and 1 <= len(authorization['brand'].strip().encode()) <= 64
            and not re.search(r'[\x00-\x1f\x7f]', authorization['brand']), 'authorization_values')
    preflight = bundle['preflight']
    require(isinstance(preflight, dict) and set(preflight) == {
        'intentSha256', 'operationSha256', 'protectedRowsSha256', 'permanentMetadataSha256', 'routine'},
        'preflight_shape')
    require(all(hex_digest(preflight[key]) for key in preflight if key != 'routine'), 'preflight_digests')
    routine = preflight['routine']
    require(isinstance(routine, dict) and set(routine) == {
        'oid', 'ownerOid', 'owner', 'acl', 'securityDefiner', 'configuration', 'language'}, 'routine_shape')
    require(type(routine['oid']) is int and routine['oid'] > 0
            and type(routine['ownerOid']) is int and routine['ownerOid'] > 0
            and routine['owner'] == 'postgres' and routine['securityDefiner'] is True
            and routine['configuration'] == ['search_path=pg_catalog']
            and routine['language'] == 'plpgsql'
            and (routine['acl'] is None or isinstance(routine['acl'], list)
                 and all(isinstance(entry, str) for entry in routine['acl'])), 'routine_controls')
    proof = bundle['proof']
    require(isinstance(proof, dict) and set(proof) == {
        'verifiedAt', 'paidAt', 'responseSha256', 'collectionSha256', 'independentlyVerified',
        'status', 'domain', 'channel', 'reusable'}, 'proof_shape')
    require(proof['independentlyVerified'] is True and proof['status'] == 'success'
            and proof['domain'] == 'test' and proof['channel'] == 'card' and proof['reusable'] is True
            and hex_digest(proof['responseSha256']) and proof['collectionSha256'] == digest(collection)
            and timestamp(proof['paidAt']) <= timestamp(proof['verifiedAt'])
            and 0 <= (now - timestamp(proof['verifiedAt'])).total_seconds() <= 60, 'fresh_independent_proof')
    return bundle
