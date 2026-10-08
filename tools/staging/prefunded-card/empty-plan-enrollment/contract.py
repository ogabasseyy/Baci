import hashlib
import json
import re
from datetime import datetime, timezone


ROOT_SCOPE = {
    'environment': 'staging', 'systemIdentifier': '7685292944002592802',
    'merchantId': '10000000-0000-4000-8000-000000000001',
    'customerId': '10000000-0000-4000-8000-000000000002',
    'actorId': 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3',
    'integrationId': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'businessId': '01M2381RG34HQJMHQKE7DWDACR',
    'oldGoalId': '430314fd-cd8b-4579-98d4-e9f345713dd6',
    'publicWalletId': '01M3W0Y93XHJY9RPQ2G75X81WG',
    'faasWalletId': '01M3W0YENHMFJ8Z9FS76E3CC6T',
    'apiCustomerId': '01M2T3PAHG3P5A32REX8MH3HD7',
    'webhookCustomerId': 'c096507d-dc32-45d2-9c01-871a27abfd10',
}
GOAL = '9f01153c-1589-4dde-b9aa-8f644a846832'
DEADLINE = '2026-10-06T15:59:10Z'
IDENTITY_SHA = '8d0a4f90a2f96182776baf91148b3bd3b27a3323eaff8d37362e24511b52d327'
HEX = re.compile(r'^[a-f0-9]{64}$')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def timestamp(value):
    require(isinstance(value, str) and value.endswith('Z'), 'timestamp')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def pinned(value, expected, code):
    require(isinstance(expected, str) and HEX.fullmatch(expected)
            and digest(value) == expected, code)


def validate(evidence, reviewed_pins, now=None):
    now = datetime.now(timezone.utc) if now is None else now
    require(now < timestamp(DEADLINE), 'expired')
    require(isinstance(evidence, dict) and isinstance(reviewed_pins, dict), 'evidence_shape')
    require(set(evidence) == {'scope', 'goalId', 'expiresAt', 'parentCommit',
                             'providerWallet', 'database'}, 'evidence_shape')
    require(evidence['scope'] == ROOT_SCOPE and evidence['goalId'] == GOAL
            and evidence['expiresAt'] == DEADLINE, 'exact_scope')
    require(set(reviewed_pins) == {'parentCommit', 'providerWallet', 'database'}, 'pins_shape')
    for field in reviewed_pins:
        require(isinstance(evidence[field], dict), field + '_shape')
        pinned(evidence[field], reviewed_pins[field], field + '_pin')
    parent = evidence['parentCommit']
    require(parent.get('kind') == 'empty_interest_goal_commit'
            and parent.get('status') == 'exact_empty_goal_bound_policy_pending'
            and parent.get('goalId') == GOAL and parent.get('changesMade') is True
            and parent.get('rolledBack') is False and parent.get('identitySha256') == IDENTITY_SHA
            and parent.get('interestPolicyEnabled') is False
            and parent.get('interestPolicyPresent') is False
            and parent.get('providerIdMappingApproved') is False
            and type(parent.get('principalKobo')) in (int, float) and parent['principalKobo'] == 0
            and type(parent.get('newPrefundingKobo')) in (int, float) and parent['newPrefundingKobo'] == 0
            and parent.get('oldGoalPrincipalKobo') == 10000, 'parent_exact_empty_commit')
    for field in ('approvalSha256', 'snapshotSha256', 'sourceManifestSha256'):
        require(isinstance(parent.get(field), str) and HEX.fullmatch(parent[field]), 'parent_proof_closure')
    for field in ('schemaMd5', 'stateMd5'):
        require(isinstance(parent.get(field), str) and re.fullmatch('[a-f0-9]{32}', parent[field]),
                'parent_proof_closure')
    wallet = evidence['providerWallet']
    require(set(wallet) == {'scope', 'retrievedAt', 'responseSha256', 'balanceKobo',
                            'interestEnabled', 'withdrawalCount'}, 'wallet_shape')
    require(wallet['scope'] == ROOT_SCOPE and wallet['interestEnabled'] is True
            and type(wallet['balanceKobo']) is int and wallet['balanceKobo'] == 0
            and type(wallet['withdrawalCount']) is int and 0 <= wallet['withdrawalCount'] <= 4
            and isinstance(wallet['responseSha256'], str) and HEX.fullmatch(wallet['responseSha256'])
            and 0 <= (now - timestamp(wallet['retrievedAt'])).total_seconds() <= 90, 'fresh_empty_wallet')
    database = evidence['database']
    require(set(database) == {'systemIdentifier', 'databaseName', 'sessionUser', 'currentUser',
                              'localSocket', 'observedAt', 'metadata'}, 'database_shape')
    require(database['systemIdentifier'] == ROOT_SCOPE['systemIdentifier']
            and database['databaseName'] == 'postgres'
            and database['sessionUser'] == database['currentUser'] == 'postgres'
            and database['localSocket'] is True
            and 0 <= (now - timestamp(database['observedAt'])).total_seconds() <= 300, 'physical_database')
    require(set(database['metadata']) == {'schemaMd5', 'securitySha256', 'protectedSha256'}, 'metadata_shape')
    for field, value in database['metadata'].items():
        length = 32 if field == 'schemaMd5' else 64
        require(isinstance(value, str) and re.fullmatch('[a-f0-9]{' + str(length) + '}', value), 'metadata_pin')
    require(database['metadata']['schemaMd5'] == parent['schemaMd5'], 'parent_schema_drift')
    return evidence
