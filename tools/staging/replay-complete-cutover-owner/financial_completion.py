"""Pure, separate read-only completion and uncommitted transaction validators.

Golden input schemas are native_fixture/completed_fixture in the colocated test.
The parent authenticates original HMAC/AEAD/crosswalk evidence and separately
guards full rows/catalog with financial_snapshot. Neither is performed here.
The pinned audit must be freshly read by the parent before each call; reported
booleans never authenticate a caller or substitute for original cryptographic proof.
Fixtures are synthetic reports, never evidence of a live completion.
Queue/unfinished/lease fields are target-scoped; do not include retired old work.
Reports must come from the parent's trusted collector, not caller assertions.
Validation is not authority to execute, restart, reset a lease or extend expiry.
"""

import hashlib
import json
import re
from datetime import datetime, timedelta
from uuid import UUID


PAYLOAD_SHA256 = '269d3c467e0c3fccb776beed56871ab1180f93ec1313a314ba62af611c0ecc7e'
OPERATION = 'ff561046-58e7-428d-9163-f6e60b0dab65'
GOAL = '9f01153c-1589-4dde-b9aa-8f644a846832'
OLD_GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
MERCHANT = '10000000-0000-4000-8000-000000000001'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
SOURCE = '01M238A0V75387H4HZ15YFWGX3'
DESTINATION = '01M3W0Y93XHJY9RPQ2G75X81WG'
PROVIDER_CUSTOMER = 'c096507d-dc32-45d2-9c01-871a27abfd10'
RECEIPT = '0f9938ae-8551-4e2e-8816-853e0231b2c3'
EVENT = '01M3YP771123DWC9Y8Y4814Z8Y'
TRANSACTION = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V'
REFERENCE = 'pvbt-' + OPERATION
KEY = 'pvb-card:' + OPERATION
EARLIEST = '2026-10-03T07:45:26.302325Z'
DEADLINE = '2026-10-06T15:59:10Z'
ORIGINAL_PROOF = 'd7c41bf04af9b1482c850d240ca190d9edd7484cbc04c868ab1626cea5583f14'
SCOPE = dict(operationId=OPERATION, goalId=GOAL, oldGoalId=OLD_GOAL,
             integrationId=INTEGRATION, treasuryBindingId=TREASURY,
             merchantId=MERCHANT, customerId=CUSTOMER, businessId=BUSINESS,
             sourceWalletId=SOURCE, destinationWalletId=DESTINATION,
             destinationCustomerId=PROVIDER_CUSTOMER, amountKobo=10000,
             currency='NGN', executionDeadline=DEADLINE)


def _require(condition):
    if not condition:
        raise ValueError('proof_refused')


def _record(value, expected, extra=()):
    _require(type(value) is dict and set(value) == set(expected) | set(extra))
    _require(all(type(value[name]) is type(item) and value[name] == item
                 for name, item in expected.items()))
    return value


def _single(value):
    _require(type(value) is list and len(value) == 1)
    return value[0]


def _timestamp(value):
    _require(type(value) is str and re.fullmatch(
        r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value))
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _time(value, earliest, latest):
    observed = _timestamp(value)
    _require(earliest <= observed <= latest)
    return observed


def _identity(value, system, login, read_only=True):
    _record(value, dict(systemIdentifier=system, sessionUser=login, currentUser=login,
                        database='postgres', localUnix=True, readOnly=read_only))


def _identifier(value):
    _require(type(value) is str and 1 <= len(value) <= 512
             and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]*', value))


def _uuid(value):
    _require(type(value) is str and str(UUID(value)) == value)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def _native(report, precommit=False):
    _require(type(PAYLOAD_SHA256) is str and re.fullmatch(r'[a-f0-9]{64}', PAYLOAD_SHA256))
    context = dict(schemaVersion=1, proofKind='native_transfer_precommit' if precommit else 'native_transfer')
    if precommit:
        context['financialCommitted'] = False
    _record(report, context,
            ('observedAt', 'appIdentity', 'scope', 'provenance', 'receiptStorage',
             'collection', 'evidence', 'crosswalk', 'conflicts'))
    observed = _timestamp(report['observedAt'])
    _require(observed >= _timestamp(EARLIEST))
    _identity(report['appIdentity'], '7685292944002592802', 'postgres', not precommit)
    _record(report['scope'], SCOPE)
    _record(report['provenance'], dict(origin='original_signed_native_receipt',
        receiptId=RECEIPT, payloadSha256=PAYLOAD_SHA256, eventId=EVENT,
        nativeTransactionId=TRANSACTION, nativeEventCategory='wallet_transfer',
        sourceProofSha256=ORIGINAL_PROOF, hmacSha512Verified=True,
        aeadVerified=True, newPaymentStarted=False), ('sourceProofObservedAt',))
    _time(report['provenance']['sourceProofObservedAt'],
          max(_timestamp(EARLIEST), observed - timedelta(seconds=60)), observed)
    storage = _record(report['receiptStorage'], dict(receiptId=RECEIPT,
        payloadSha256=PAYLOAD_SHA256, signatureReceiptId=RECEIPT,
        signaturePayloadSha256=PAYLOAD_SHA256, receiptCount=1, signatureCount=1,
        signaturePreserved=True, signedPayloadHashMatches=True,
        claimTokenPresent=False, leaseExpiresAt=None), ('identity', 'status', 'observedAt'))
    _identity(storage['identity'], '7686901100561231906', 'supabase_admin')
    _time(storage['observedAt'], max(_timestamp(EARLIEST), observed - timedelta(seconds=60)), observed)
    _require(type(storage['status']) is str and storage['status'] in
             ('received', 'quarantined', 'processed', 'dead_letter'))
    collection = _record(report['collection'], dict(operationId=OPERATION,
        status='verified_success', amountKobo=10000, currency='NGN'), ('providerTransactionId',))
    _identifier(collection['providerTransactionId'])
    evidence = _record(_single(report['evidence']), dict(integrationId=INTEGRATION,
        eventId=EVENT, fingerprint=PAYLOAD_SHA256, businessId=BUSINESS, conflicted=False,
        status='verified', kind='internal_transfer', eventType='wallet-transfer.outflow.success',
        eventCategory='wallet-transfer', providerTransactionId=TRANSACTION,
        reference=REFERENCE, sourceWalletId=SOURCE, destinationWalletId=DESTINATION,
        destinationCustomerId=PROVIDER_CUSTOMER, amountKobo=10000, currency='NGN', feeKobo=0),
        ('createdAt', 'references'))
    _require(_time(evidence['createdAt'], _timestamp(EARLIEST), observed) < _timestamp(DEADLINE))
    references = evidence['references']
    _require(type(references) is list and 2 <= len(references) <= 24
             and all(type(item) is str and 1 <= len(item) <= 512 for item in references)
             and len(set(references)) == len(references)
             and {REFERENCE, TRANSACTION} <= set(references)
             and all(not item.startswith('pvbt-') or item == REFERENCE for item in references))
    _record(report['crosswalk'], dict(publicWalletId=DESTINATION,
        faasWalletId='01M3W0YENHMFJ8Z9FS76E3CC6T', apiCustomerId='01M2T3PAHG3P5A32REX8MH3HD7',
        providerCustomerId=PROVIDER_CUSTOMER, nativeCustomerId=PROVIDER_CUSTOMER,
        mappingGoalId=GOAL, mappingIntegrationId=INTEGRATION,
        sourceMatches=True, destinationMatches=True, customerMatches=True,
        businessMatches=True, referenceMatches=True, nativeTransactionMatches=True,
        publicFaasMatches=True, mappingWalletMatches=True, mappingCustomerMatches=True))
    _require(type(report['conflicts']) is list and not report['conflicts'])


def validate_native_evidence(report):
    try:
        _native(report)
        return dict(nativeEvidencePassed=True, nativeEvidenceSha256=_digest(report),
                    nativeEvidenceObservedAt=report['observedAt'])
    except Exception:
        raise ValueError('native_evidence_refused') from None


def _completed(report, precommit=False):
    context = dict(schemaVersion=1, proofKind='financial_precommit' if precommit else 'financial_completion', activeLeaseCount=0)
    if precommit:
        context['financialCommitted'] = False
    _record(report, context,
        ('observedAt', 'appIdentity', 'nativeEvidence', 'operation', 'queue', 'unfinishedOperations',
         'treasury', 'goals', 'projections', 'ledgerOperations', 'contributions', 'postings',
         'aliases', 'notifications'))
    native = report['nativeEvidence']
    _native(native, precommit)
    _identity(report['appIdentity'], '7685292944002592802', 'postgres', not precommit)
    observed = _timestamp(report['observedAt'])
    _require(observed >= _timestamp(native['observedAt']))
    _time(native['provenance']['sourceProofObservedAt'], observed - timedelta(seconds=60), observed)
    _time(native['receiptStorage']['observedAt'], observed - timedelta(seconds=60), observed)
    _require(native['receiptStorage']['status'] == 'processed')
    operation = _record(report['operation'], dict(operationId=OPERATION, goalId=GOAL,
        integrationId=INTEGRATION, treasuryBindingId=TREASURY, merchantId=MERCHANT, customerId=CUSTOMER,
        amountKobo=10000, currency='NGN', destinationWalletId=DESTINATION,
        destinationCustomerId=PROVIDER_CUSTOMER, checkoutRetired=False,
        collectionStatus='verified_success', transferStatus='verified_success', projectionStatus='applied',
        transferProviderTransactionId=TRANSACTION,
        collectionProviderTransactionId=native['collection']['providerTransactionId'],
        collectionProofPresent=True, verificationTokenPresent=False, verificationLeaseExpiresAt=None),
        ('transferAttemptedAt', 'intentPhase'))
    _require(type(operation['intentPhase']) is str and operation['intentPhase'] in ('funding_pending', 'completed'))
    native_created = _timestamp(native['evidence'][0]['createdAt'])
    _require(_timestamp(operation['transferAttemptedAt']) <= native_created)
    _require(type(report['unfinishedOperations']) is list and not report['unfinishedOperations'])
    _record(report['treasury'], dict(treasuryBindingId=TREASURY, integrationId=INTEGRATION,
        businessId=BUSINESS, sourceWalletId=SOURCE, budgetKobo=10000, openingAvailableKobo=10000,
        replenishedKobo=0, reservedKobo=0, consumedKobo=10000))
    goals = report['goals']
    _require(type(goals) is list and len(goals) == 2 and all(type(goal) is dict for goal in goals))
    _require({goal.get('goalId') for goal in goals} == {GOAL, OLD_GOAL})
    selected = next(goal for goal in goals if goal['goalId'] == GOAL)
    old = next(goal for goal in goals if goal['goalId'] == OLD_GOAL)
    _record(old, dict(goalId=OLD_GOAL, displayedPrincipalKobo=10000, canonicalPrincipalKobo=10000))
    _record(selected, dict(goalId=GOAL, displayedPrincipalKobo=10000, canonicalPrincipalKobo=10000),
            ('targetKobo', 'status', 'completedAt'))
    target = selected['targetKobo']
    _require(type(target) is int and 10000 <= target <= 9007199254740991)
    _require(selected['status'] == ('completed' if target == 10000 else 'active'))
    projection = _record(_single(report['projections']), dict(operationId=OPERATION,
        ledgerOperationId=OPERATION, amountKobo=10000), ('contributionId', 'createdAt'))
    _uuid(projection['contributionId'])
    projected = _time(projection['createdAt'], native_created, observed)
    _require(projected < _timestamp(DEADLINE))
    if target == 10000:
        _require(_time(selected['completedAt'], projected, observed) < _timestamp(DEADLINE))
    else:
        _require(selected['completedAt'] is None)
    queue = _record(_single(report['queue']), dict(operationId=OPERATION,
        claimTokenPresent=False, leaseExpiresAt=None), ('finishedAt',))
    _require(_time(queue['finishedAt'], projected, observed) < _timestamp(DEADLINE))
    _record(_single(report['ledgerOperations']), dict(operationId=OPERATION, goalId=GOAL,
        integrationId=INTEGRATION, merchantId=MERCHANT, customerId=CUSTOMER,
        evidenceId=KEY, kind='credit_principal', principalKobo=10000, interestKobo=0))
    _record(_single(report['contributions']), dict(contributionId=projection['contributionId'],
        goalId=GOAL, merchantId=MERCHANT, customerId=CUSTOMER, amountKobo=10000,
        sourceType='paystack_authorization', status='completed', idempotencyKey=KEY,
        metadataOperationId=OPERATION, metadataProviderTransactionId=TRANSACTION, transferReference=REFERENCE))
    postings = report['postings']
    _require(type(postings) is list and len(postings) == 2)
    for posting in postings:
        _record(posting, dict(operationId=OPERATION), ('account', 'amountKobo'))
        _require(type(posting['account']) is str and type(posting['amountKobo']) is int)
    _require({item['account']: item['amountKobo'] for item in postings} ==
             {'principal': 10000, 'internal_clearing': -10000})
    _record(_single(report['aliases']), dict(integrationId=INTEGRATION,
        providerTransactionId=TRANSACTION, operationId=OPERATION))
    milestone = max((value for value in (25, 50, 75, 90, 100) if 1000000 >= target * value), default=0)
    notification = _record(_single(report['notifications']), dict(goalId=GOAL,
        merchantId=MERCHANT, customerId=CUSTOMER, voidedAt=None,
        eventKey='milestone:' + str(milestone) if milestone else 'first-contribution',
        type='goal_completed' if milestone == 100 else 'milestone' if milestone else 'first_contribution'),
        ('notificationId',))
    _uuid(notification['notificationId'])


def validate_completed(report):
    try:
        _completed(report)
        return dict(financialProofPassed=True, financialProofSha256=_digest(report),
                    financialProofObservedAt=report['observedAt'])
    except Exception:
        raise ValueError('financial_completion_refused') from None


def validate_native_precommit(report: dict) -> dict:
    try:
        _native(report, precommit=True)
        return dict(nativePrecommitPassed=True, financialCommitted=False,
                    proofKind='native_transfer_precommit', nativePrecommitSha256=_digest(report))
    except Exception:
        raise ValueError('native_precommit_refused') from None


def validate_precommit(report: dict) -> dict:
    try:
        _completed(report, precommit=True)
        return dict(financialPrecommitPassed=True, financialCommitted=False,
                    proofKind='financial_precommit', financialPrecommitSha256=_digest(report),
                    financialPrecommitObservedAt=report['observedAt'])
    except Exception:
        raise ValueError('financial_precommit_refused') from None
