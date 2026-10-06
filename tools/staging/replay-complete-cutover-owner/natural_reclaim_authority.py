from datetime import datetime, timezone
import hashlib
import json
import re


MIGRATION = 'supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql'
SOURCE_FILES = {
    'storage-functions.sql': '7eddf4a0ed7df1613ea4b4a0163438a3f1c85fa3b00182cd9ee114c9d50c5c7f',
    'dispatch-queue.sql': 'd56cf3bcb3a280b76691ed9288219a769b0e0634838a1dddbeff7695f57eb217',
    'checkout-retirement-storage.sql': '7b169a6f8269bb4ad86c7527c2135046ca22a413b670519b1fdaa0c974455c8a',
    'checkout-storage.sql': 'a2f04e097b46158d26f4469424dc92b387ecd9494af738ca1c2a0c489661693d',
    'projection-storage.sql': '57688231ca63c642eadc6c66fda82a3fdde33e546da2f4514b0498983cee3479',
    'checkout_retirement_patches.py': '118a8a6a79eac61d005ab5dd70d4c07c46965b99584855ccd69f5a8bd64f5416',
    MIGRATION: '05af1e6f87a118aefe6cf097569daa5dcf7e52922cfb1d1fdbff884b2f5d67ae',
}
SOURCE_CLOSURE = 'e03d299d3e4663e55c8c6d4fa8159380e46c3ff8de816ab11119cb91923422e7'
OLD = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
TARGET = 'ff561046-58e7-428d-9163-f6e60b0dab65'
TRANSACTION = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V'
IDENTITY = dict(systemIdentifier='7685292944002592802', database='postgres', sessionUser='postgres',
    currentUser='postgres', localSocket=True, readOnly=True, isolation='repeatable read',
    superuser=True, replicationRole='origin')
BACKGROUND_IDENTITY_KEYS = ('systemIdentifier', 'database', 'databaseOid', 'sessionUser',
    'currentUser', 'localSocket', 'readOnly', 'isolation')
SCOPE = dict(operationId=TARGET, newGoalId='9f01153c-1589-4dde-b9aa-8f644a846832',
    oldGoalId='430314fd-cd8b-4579-98d4-e9f345713dd6',
    treasuryBindingId='ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    integrationId='d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    merchantId='10000000-0000-4000-8000-000000000001',
    customerId='10000000-0000-4000-8000-000000000002', businessId='01M2381RG34HQJMHQKE7DWDACR')
DRAIN_KEYS = frozenset(('preparedTransactions', 'otherClientTransactions', 'activeVerificationLeases',
    'activeInitializationLeases', 'activeDispatchLeases', 'malformedVerificationPairs',
    'malformedInitializationPairs', 'malformedDispatchPairs', 'expiredVerificationPairs',
    'expiredInitializationPairs', 'expiredDispatchPairs'))
OLD_ROW = dict(id=OLD, rowSha256='8f36f7b62ea6f37a71e33d426e11e884345bb6ee162ad376773183704da11d1e',
    tokenSha256='1c11712f0836aef6a8a2814f4be51c8b755375e9be1f8749955162d9008b0a28',
    verificationFence=1556, transferFence=0, leaseExpiresAt='2026-09-29T12:08:29.087723Z',
    checkoutRetired=True, collectionStatus='pending', transferStatus='not_started',
    projectionStatus='unapplied', transferProviderTransactionId=None)
TARGET_ROW = dict(id=TARGET, rowSha256='55f9b61e138db6cc724d54b49bd5a17afef5f33a7c1a2da419d355fa62abe147',
    tokenSha256='90383d30c81e71385867837a1b10b80c4820dcd5cae1bfb33df59473dd7bd69a',
    verificationFence=326, transferFence=1, leaseExpiresAt='2026-10-02T19:33:22.929143Z',
    checkoutRetired=False, collectionStatus='verified_success', transferStatus='dispatching',
    projectionStatus='unapplied', transferProviderTransactionId=None)
RETIREMENT = dict(id=OLD, intentId=OLD,
    rowSha256='eea547a57d8762fd28d5ed34af6d88c786ba3854b2106998f1856fff4a1b546e',
    retiredAt='2026-09-29T12:08:45.240803Z')
RETIRED_INTENT = dict(id=OLD, operationId=OLD, phase='retired_unconfirmed',
    rowSha256='5370fb4374135c8470f9ab6683853c1e2d0cf7b06bea4b62081b927ca5e6ada9')
INTENT_GUARD = 'guard_first_card_checkout_intent()'
INTENT_GUARD_METADATA = '29349af677628852c3667b65b7655cd45c36c35db6d08e915f68ceec96ad12eb'
CLAIMS = ('claim_due(uuid,text,text,integer,uuid,uuid)', 'claim_reconciliation(uuid,integer)')
FUNCTIONS = {
    CLAIMS[0]: (45664, 'c906037f7ec821833df531dfe905df37bec661a00e9334f17bd67f9b89aff443', 'jsonb', True, 0),
    CLAIMS[1]: (45391, 'f01336b106edcf32714af2e8069cddbc33537b93d6bfaa3fc0743a9013d7b209', 'jsonb', True, 0),
    'complete_reconciliation(uuid,uuid,bigint,text,text,jsonb)': (45392,
        'd0f2cb626bb7dbdcd9e0f086a032dd397fd9a92079972be9d64bfc05637b4f06', 'text', True, 0),
    'record_transfer(uuid,bigint,text,jsonb)': (45394,
        '36c5ed3a1cdb5b032d00d328915cc96ca19a3a6974dbc91cc351722ea9ee8150', 'text', True, 0),
    'lock_scoped_operation(uuid,boolean)': (45387,
        '32a07a6e7e7fea48f3d63e251b77bd03e499e62c67830cce31ad09732e118717', 'prefunded_card.operations', True, 1),
    'checkout_is_retired(uuid)': (None,
        '2f9050daab569e6c53a69f3c6b7d517e590f35bf365d0faaa2edc9c69776ce9d', 'boolean', True, 0),
    'guard_retired_checkout_operation()': (46420,
        'ded692844428f7023dfca055d777b862022bf8265f0da8b540ccab98fc190829', 'trigger', True, 0),
    'guard_retired_checkout_credit()': (46422,
        '5c8ad5defaf3c319af369301758775ba11dd808e1ece160ff20df1825295e0a8', 'trigger', True, 0),
    'reject_projection_mutation()': (45545,
        '6cc732de364aeeb29fb94fef26e3fa21f740df18b5e519907871c8bb8c28e1ec', 'trigger', False, 0),
    INTENT_GUARD: (45972,
        '0aca31e1e488d0c5e115259d56067b9bd9948d568f49423aadb97f3abb3365c1', 'trigger', False, 0),
}
TRIGGERS = {
    ('prefunded_card.provider_aliases', 'checkout_retired_alias_guard'): (46422, 7),
    ('piggyvest_savings_ledger.operations', 'checkout_retired_ledger_guard'): (46422, 7),
    ('prefunded_card.operations', 'checkout_retired_operation_guard'): (46420, 23),
    ('prefunded_card.projections', 'checkout_retired_projection_guard'): (46422, 7),
    ('prefunded_card.checkout_retirements', 'checkout_retirements_immutable'): (45545, 27),
    ('prefunded_card.checkout_retirements', 'checkout_retirements_no_truncate'): (45545, 34),
    ('prefunded_card.checkout_intents', 'prefunded_first_card_checkout_intent_guard'): (45972, 27),
    ('prefunded_card.checkout_intents', 'prefunded_first_card_checkout_intent_no_truncate'): (45972, 34),
}
INTENT_TRIGGER_METADATA = {
    ('prefunded_card.checkout_intents', 'prefunded_first_card_checkout_intent_guard'):
        '6db77340edb16fd527849ca29cd1084fd8425b66bfd59693033254f08bb01900',
    ('prefunded_card.checkout_intents', 'prefunded_first_card_checkout_intent_no_truncate'):
        '073bfeb803f17d819978227dde66131481813a801540842a32546e3941721448',
}


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def require(condition):
    if not condition:
        raise ValueError('natural_reclaim_refused')


def sha(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None


def function_acl(name):
    return ['postgres=X/postgres', 'prefunded_treasury_operator=X/postgres'] if name in tuple(FUNCTIONS)[:4] else ['postgres=X/postgres']


def instant(value):
    require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{6})?Z', value) is not None)
    return datetime.fromisoformat(value[:-1] + '+00:00')


def verify_catalog(report, pin, owner_oid):
    require(sha(pin) and set(report['routines']) == set(FUNCTIONS))
    lines = []
    for name, (oid, body, returns, definer, defaults) in FUNCTIONS.items():
        value = report['routines'][name]
        require(type(value['oid']) is int and value['oid'] > 0 and (oid is None or value['oid'] == oid))
        expected = dict(ownerOid=owner_oid, owner='postgres', language='plpgsql', securityDefiner=definer,
            configuration=['search_path=pg_catalog'], acl=function_acl(name), bodySha256=body,
            returnType=returns, kind='f', volatility='v', parallel='u', strict=False,
            leakproof=False, argumentDefaults=defaults)
        require(encoded({key: value[key] for key in expected}) == encoded(expected) and sha(value['metadataSha256']))
        require(set(value) == set(expected) | {'oid', 'metadataSha256'})
        if name == INTENT_GUARD:
            require(value['metadataSha256'] == INTENT_GUARD_METADATA)
        lines.append('function:' + name + ':' + value['metadataSha256'])
    require(len(report['triggers']) == len(TRIGGERS))
    seen = set()
    for value in report['triggers']:
        key = (value['table'], value['name'])
        require(key in TRIGGERS and key not in seen)
        seen.add(key)
        function_oid, kind = TRIGGERS[key]
        expected = dict(table=key[0], name=key[1], functionOid=function_oid, type=kind,
            enabled='O', internal=False, argumentCount=0, hasCondition=False, constraintTrigger=False)
        require(encoded({name: value[name] for name in expected}) == encoded(expected) and sha(value['metadataSha256']))
        require(set(value) == set(expected) | {'metadataSha256'})
        if key in INTENT_TRIGGER_METADATA:
            require(value['metadataSha256'] == INTENT_TRIGGER_METADATA[key])
        lines.append('trigger:' + key[0] + '.' + key[1] + ':' + value['metadataSha256'])
    require(hashlib.sha256('\n'.join(sorted(lines)).encode()).hexdigest() == pin == report['catalogSha256'])


def classify_natural_reclaim(report, background, *, source_files, reviewed_catalog_sha256,
                            now, projection_target_row_sha256=None):
    try:
        require(set(source_files) == set(SOURCE_FILES))
        actual_sources = {}
        for name, value in source_files.items():
            require(type(value) is bytes)
            actual_sources[name] = hashlib.sha256(value).hexdigest()
        require(actual_sources == SOURCE_FILES and hashlib.sha256(encoded(actual_sources)).hexdigest() == SOURCE_CLOSURE)
        report, background = json.loads(encoded(report)), json.loads(encoded(background))
        require(isinstance(now, datetime) and now.tzinfo is not None and now.utcoffset().total_seconds() == 0)
        require(now.timestamp() < 1791301750)
        require(type(report['version']) is int and report['version'] == 1 and type(background['version']) is int and background['version'] == 1)
        require(report['sourceClosureSha256'] == SOURCE_CLOSURE)
        for capture in (report, background):
            require(0 <= (now - instant(capture['capturedAt'])).total_seconds() <= 60)
        require(abs((instant(report['capturedAt']) - instant(background['capturedAt'])).total_seconds()) <= 30)
        identity = report['identity']
        require(set(identity) == set(IDENTITY) | {'databaseOid', 'roleOid'})
        require(encoded({key: identity[key] for key in IDENTITY}) == encoded(IDENTITY))
        for name in ('databaseOid', 'roleOid'):
            require(type(identity[name]) is int and identity[name] > 0)
        require(encoded(background['identity']) == encoded({key: identity[key] for key in BACKGROUND_IDENTITY_KEYS}))
        verify_catalog(report, reviewed_catalog_sha256, identity['roleOid'])
        phase = report['phase']
        require(phase in ('verify_existing_transfer', 'apply_verified_projection') and background['phase'] == phase)
        require(background['blockers'] == ['verification_leases'])
        require(set(background['scope']) == set(SCOPE) | {'workerLogin'})
        require(encoded({key: background['scope'][key] for key in SCOPE}) == encoded(SCOPE))
        require(type(background['scope']['workerLogin']) is str and bool(background['scope']['workerLogin']))
        expected_drain = {key: 0 for key in DRAIN_KEYS}
        expected_drain['expiredVerificationPairs'] = 2 if phase == 'verify_existing_transfer' else 1
        require(encoded(report['drain']) == encoded(expected_drain) == encoded(background['drain']))
        require(encoded(background['work']) == encoded(dict(otherNonretiredUnfinishedOperations=0,
            recoveryPhaseIntents=0, scopedRecoveryCandidates=0)))
        require(encoded(background['principalsKobo']) == encoded(dict(oldGoal=10000, newGoal=0)))
        treasury = dict(budgetKobo=10000, reservedKobo=10000, consumedKobo=0) if phase == 'verify_existing_transfer' else dict(budgetKobo=10000, reservedKobo=0, consumedKobo=10000)
        require(encoded(background['treasury']) == encoded(treasury))
        require(encoded(report['retirement']) == encoded(RETIREMENT))
        require(encoded(report['retiredIntent']) == encoded(RETIRED_INTENT))
        require(len(report['operations']) == 2)
        operations = {value['id']: value for value in report['operations']}
        require(set(operations) == {OLD, TARGET} and encoded(operations[OLD]) == encoded(OLD_ROW))
        target = dict(TARGET_ROW)
        if phase == 'apply_verified_projection':
            require(sha(projection_target_row_sha256) and projection_target_row_sha256 != TARGET_ROW['rowSha256'])
            target.update(rowSha256=projection_target_row_sha256, tokenSha256=None, leaseExpiresAt=None,
                verificationFence=327, transferStatus='verified_success', transferProviderTransactionId=TRANSACTION)
        require(encoded(operations[TARGET]) == encoded(target))
        expected_pairs = [OLD_ROW, target] if phase == 'verify_existing_transfer' else [OLD_ROW]
        require(encoded(sorted(report['expiredPairs'], key=lambda value: value['id'])) == encoded(sorted(expected_pairs, key=lambda value: value['id'])))
        for row in expected_pairs:
            require(instant(row['leaseExpiresAt']) < now)
        target_state = {key: target[key] for key in ('collectionStatus', 'transferStatus', 'projectionStatus')}
        require(encoded({key: background['target'][key] for key in target_state}) == encoded(target_state))
        require(background['target'].get('transferProviderTransactionId') == target['transferProviderTransactionId'])
        return dict(status='classified_only', classifiedBlocker='verification_leases',
            safelyNaturallyReclaimable=True, phase=phase, operationId=TARGET, preservedRetiredOperationId=OLD,
            sourceClosureSha256=SOURCE_CLOSURE, catalogSha256=reviewed_catalog_sha256,
            financialActionAuthorized=False, requiredIndependentProofs=[
                'fresh_verified_native_evidence', 'quiescence', 'full_financial_baseline'])
    except Exception:
        raise ValueError('natural_reclaim_refused') from None
