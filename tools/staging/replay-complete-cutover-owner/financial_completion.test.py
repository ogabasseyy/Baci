import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    'financial_completion', Path(__file__).with_name('financial_completion.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
FIXTURE_HASH = '269d3c467e0c3fccb776beed56871ab1180f93ec1313a314ba62af611c0ecc7e'
OPERATION = 'ff561046-58e7-428d-9163-f6e60b0dab65'
GOAL = '9f01153c-1589-4dde-b9aa-8f644a846832'
OLD_GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
MERCHANT = '10000000-0000-4000-8000-000000000001'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
PROVIDER_CUSTOMER = 'c096507d-dc32-45d2-9c01-871a27abfd10'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
SOURCE = '01M238A0V75387H4HZ15YFWGX3'
DESTINATION = '01M3W0Y93XHJY9RPQ2G75X81WG'
RECEIPT = '0f9938ae-8551-4e2e-8816-853e0231b2c3'
EVENT = '01M3YP771123DWC9Y8Y4814Z8Y'
TRANSACTION = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V'
REFERENCE = 'pvbt-' + OPERATION
KEY = 'pvb-card:' + OPERATION
CONTRIBUTION = '20000000-0000-4000-8000-000000000001'
OBSERVED = '2026-10-03T07:46:00Z'


def identity(system, login):
    return dict(systemIdentifier=system, sessionUser=login, currentUser=login,
                database='postgres', localUnix=True, readOnly=True)


def native_fixture():
    return dict(
        schemaVersion=1, proofKind='native_transfer', observedAt=OBSERVED,
        appIdentity=identity('7685292944002592802', 'postgres'),
        scope=dict(operationId=OPERATION, goalId=GOAL, oldGoalId=OLD_GOAL,
                   integrationId=INTEGRATION, treasuryBindingId=TREASURY,
                   merchantId=MERCHANT, customerId=CUSTOMER, businessId=BUSINESS,
                   sourceWalletId=SOURCE, destinationWalletId=DESTINATION,
                   destinationCustomerId=PROVIDER_CUSTOMER, amountKobo=10000,
                   currency='NGN', executionDeadline='2026-10-06T15:59:10Z'),
        provenance=dict(origin='original_signed_native_receipt', receiptId=RECEIPT,
                        payloadSha256=FIXTURE_HASH, eventId=EVENT,
                        nativeTransactionId=TRANSACTION, nativeEventCategory='wallet_transfer',
                        sourceProofSha256='d7c41bf04af9b1482c850d240ca190d9edd7484cbc04c868ab1626cea5583f14',
                        hmacSha512Verified=True, aeadVerified=True, newPaymentStarted=False,
                        sourceProofObservedAt='2026-10-03T07:45:59Z'),
        receiptStorage=dict(identity=identity('7686901100561231906', 'supabase_admin'),
                            receiptId=RECEIPT, payloadSha256=FIXTURE_HASH,
                            signatureReceiptId=RECEIPT, signaturePayloadSha256=FIXTURE_HASH,
                            receiptCount=1, signatureCount=1, signaturePreserved=True,
                            signedPayloadHashMatches=True, status='processed',
                            claimTokenPresent=False, leaseExpiresAt=None, observedAt='2026-10-03T07:45:58Z'),
        collection=dict(operationId=OPERATION, status='verified_success', amountKobo=10000,
                        currency='NGN', providerTransactionId='test-existing-collection'),
        evidence=[dict(integrationId=INTEGRATION, eventId=EVENT, fingerprint=FIXTURE_HASH,
                       businessId=BUSINESS, createdAt='2026-10-03T07:45:30Z',
                       conflicted=False, status='verified', kind='internal_transfer',
                       eventType='wallet-transfer.outflow.success', eventCategory='wallet-transfer',
                       providerTransactionId=TRANSACTION, reference=REFERENCE,
                       references=[REFERENCE, TRANSACTION], sourceWalletId=SOURCE,
                       destinationWalletId=DESTINATION, destinationCustomerId=PROVIDER_CUSTOMER,
                       amountKobo=10000, currency='NGN', feeKobo=0)],
        crosswalk=dict(publicWalletId=DESTINATION, faasWalletId='01M3W0YENHMFJ8Z9FS76E3CC6T',
                       apiCustomerId='01M2T3PAHG3P5A32REX8MH3HD7', providerCustomerId=PROVIDER_CUSTOMER,
                       nativeCustomerId=PROVIDER_CUSTOMER, mappingGoalId=GOAL, mappingIntegrationId=INTEGRATION,
                       sourceMatches=True, destinationMatches=True, customerMatches=True,
                       businessMatches=True, referenceMatches=True, nativeTransactionMatches=True,
                       publicFaasMatches=True, mappingWalletMatches=True, mappingCustomerMatches=True),
        conflicts=[])


def completed_fixture():
    report = dict(
        schemaVersion=1, proofKind='financial_completion', observedAt='2026-10-03T07:48:00Z',
        appIdentity=identity('7685292944002592802', 'postgres'), nativeEvidence=native_fixture(),
        operation=dict(operationId=OPERATION, goalId=GOAL, integrationId=INTEGRATION,
                       treasuryBindingId=TREASURY, merchantId=MERCHANT, customerId=CUSTOMER,
                       amountKobo=10000, currency='NGN', destinationWalletId=DESTINATION,
                       destinationCustomerId=PROVIDER_CUSTOMER, checkoutRetired=False,
                       collectionStatus='verified_success', transferStatus='verified_success',
                       projectionStatus='applied', transferProviderTransactionId=TRANSACTION,
                       collectionProviderTransactionId='test-existing-collection', collectionProofPresent=True,
                       verificationTokenPresent=False, verificationLeaseExpiresAt=None,
                       transferAttemptedAt='2026-10-01T13:05:30Z', intentPhase='funding_pending'),
        queue=[dict(operationId=OPERATION, claimTokenPresent=False, leaseExpiresAt=None,
                    finishedAt='2026-10-03T07:47:10Z')],
        unfinishedOperations=[], activeLeaseCount=0,
        treasury=dict(treasuryBindingId=TREASURY, integrationId=INTEGRATION, businessId=BUSINESS,
                      sourceWalletId=SOURCE, budgetKobo=10000, openingAvailableKobo=10000,
                      replenishedKobo=0, reservedKobo=0, consumedKobo=10000),
        goals=[dict(goalId=GOAL, displayedPrincipalKobo=10000, canonicalPrincipalKobo=10000,
                    targetKobo=10000, status='completed', completedAt='2026-10-03T07:47:00Z'),
               dict(goalId=OLD_GOAL, displayedPrincipalKobo=10000, canonicalPrincipalKobo=10000)],
        projections=[dict(operationId=OPERATION, ledgerOperationId=OPERATION, amountKobo=10000,
                          contributionId=CONTRIBUTION, createdAt='2026-10-03T07:47:00Z')],
        ledgerOperations=[dict(operationId=OPERATION, goalId=GOAL, integrationId=INTEGRATION,
                               merchantId=MERCHANT, customerId=CUSTOMER, evidenceId=KEY,
                               kind='credit_principal', principalKobo=10000, interestKobo=0)],
        contributions=[dict(contributionId=CONTRIBUTION, goalId=GOAL, merchantId=MERCHANT,
                            customerId=CUSTOMER, amountKobo=10000, sourceType='paystack_authorization',
                            status='completed', idempotencyKey=KEY, metadataOperationId=OPERATION,
                            metadataProviderTransactionId=TRANSACTION, transferReference=REFERENCE)],
        postings=[dict(operationId=OPERATION, account='principal', amountKobo=10000),
                  dict(operationId=OPERATION, account='internal_clearing', amountKobo=-10000)],
        aliases=[dict(integrationId=INTEGRATION, providerTransactionId=TRANSACTION, operationId=OPERATION)],
        notifications=[dict(notificationId='20000000-0000-4000-8000-000000000002',
                            goalId=GOAL, merchantId=MERCHANT, customerId=CUSTOMER,
                            eventKey='milestone:100', type='goal_completed', voidedAt=None)])
    refresh_native(report['nativeEvidence'], report['observedAt'])
    return report


def refresh_native(report, observed):
    report['observedAt'] = observed
    report['provenance']['sourceProofObservedAt'] = observed
    report['receiptStorage']['observedAt'] = observed


def change(report, path, value):
    for component in path[:-1]:
        report = report[component]
    report[path[-1]] = value


class FinancialCompletionTests(unittest.TestCase):
    def test_native_exact_signed_event_is_valid_without_mutating_report(self):
        report = native_fixture()
        before = copy.deepcopy(report)
        result = MODULE.validate_native_evidence(report)
        self.assertTrue(result['nativeEvidencePassed'])
        self.assertEqual(report, before)
        self.assertEqual(result, MODULE.validate_native_evidence(report))
    def test_completed_exact_credit_is_valid_and_idempotent(self):
        report = completed_fixture()
        before = copy.deepcopy(report)
        result = MODULE.validate_completed(report)
        self.assertEqual(set(result), {'financialProofPassed', 'financialProofSha256', 'financialProofObservedAt'})
        self.assertIs(result['financialProofPassed'], True)
        self.assertEqual(result, MODULE.validate_completed(report))
        self.assertEqual(report, before)
    def test_missing_parent_payload_pin_refuses_even_matching_synthetic_report(self):
        with patch.object(MODULE, 'PAYLOAD_SHA256', None):
            with self.assertRaisesRegex(ValueError, '^native_evidence_refused$'):
                MODULE.validate_native_evidence(native_fixture())
    def test_native_mismatches_unsigned_storage_stale_and_sample_proof_refuse(self):
        cases = [
            (('scope', 'goalId'), OLD_GOAL), (('scope', 'amountKobo'), 20000),
            (('scope', 'treasuryBindingId'), OPERATION), (('scope', 'customerId'), MERCHANT),
            (('appIdentity', 'systemIdentifier'), '7686901100561231906'),
            (('appIdentity', 'readOnly'), False), (('appIdentity', 'sessionUser'), 'service_role'),
            (('observedAt',), '2026-10-03T07:45:26.302324Z'),
            (('provenance', 'hmacSha512Verified'), False), (('provenance', 'aeadVerified'), False),
            (('provenance', 'newPaymentStarted'), True), (('provenance', 'origin'), 'foreign_sample'),
            (('provenance', 'payloadSha256'), '269d' + 'b' * 60),
            (('provenance', 'sourceProofSha256'), 'f' * 64),
            (('provenance', 'sourceProofObservedAt'), '2026-10-03T07:44:59Z'),
            (('receiptStorage', 'signaturePreserved'), False), (('receiptStorage', 'signatureCount'), 0),
            (('receiptStorage', 'signaturePayloadSha256'), 'b' * 64),
            (('receiptStorage', 'identity', 'readOnly'), False),
            (('receiptStorage', 'observedAt'), '2026-10-03T07:44:59Z'),
            (('evidence', 0, 'eventId'), 'old-event'), (('evidence', 0, 'status'), 'deferred'),
            (('evidence', 0, 'eventCategory'), 'wallet_transfer'),
            (('evidence', 0, 'providerTransactionId'), 'PVB01M3YP7BF72MD3PXVY2G8ZXCS0'),
            (('evidence', 0, 'kind'), 'bank_inflow'), (('evidence', 0, 'conflicted'), True),
            (('evidence', 0, 'references'), [REFERENCE]), (('evidence', 0, 'feeKobo'), 1),
            (('evidence', 0, 'amountKobo'), '10000'), (('evidence', 0, 'createdAt'), '2026-10-02T00:00:00Z'),
            (('crosswalk', 'providerCustomerId'), '01M2T3PAHG3P5A32REX8MH3HD7'),
            (('crosswalk', 'nativeCustomerId'), BUSINESS),
            (('crosswalk', 'mappingGoalId'), OLD_GOAL), (('crosswalk', 'publicFaasMatches'), False),
            (('conflicts',), [{'eventId': EVENT}]), (('schemaVersion',), True),
        ]
        for path, value in cases:
            with self.subTest(path=path):
                report = native_fixture()
                change(report, path, value)
                with self.assertRaisesRegex(ValueError, '^native_evidence_refused$'):
                    MODULE.validate_native_evidence(report)
    def test_completed_partial_duplicate_unbalanced_and_old_total_refuse(self):
        cases = [
            (('operation', 'collectionStatus'), 'pending'), (('operation', 'transferStatus'), 'dispatching'),
            (('operation', 'projectionStatus'), 'unapplied'), (('operation', 'checkoutRetired'), True),
            (('operation', 'collectionProofPresent'), False), (('operation', 'intentPhase'), 'reconciliation_required'),
            (('operation', 'verificationTokenPresent'), True), (('operation', 'collectionProviderTransactionId'), ''),
            (('queue', 0, 'finishedAt'), None), (('queue', 0, 'claimTokenPresent'), True),
            (('queue', 0, 'leaseExpiresAt'), '2026-10-03T07:49:00Z'), (('activeLeaseCount',), 1),
            (('unfinishedOperations',), [{'operationId': OPERATION}]),
            (('treasury', 'budgetKobo'), 20000), (('treasury', 'reservedKobo'), 10000),
            (('treasury', 'consumedKobo'), 0), (('treasury', 'replenishedKobo'), 10000),
            (('goals', 0, 'displayedPrincipalKobo'), 0), (('goals', 1, 'canonicalPrincipalKobo'), 0),
            (('projections', 0, 'ledgerOperationId'), TREASURY),
            (('projections', 0, 'createdAt'), '2026-10-06T15:59:10Z'),
            (('ledgerOperations', 0, 'interestKobo'), 10000), (('ledgerOperations', 0, 'evidenceId'), 'old-credit'),
            (('contributions', 0, 'sourceType'), 'bank_transfer'), (('contributions', 0, 'status'), 'pending'),
            (('contributions', 0, 'amountKobo'), 100), (('contributions', 0, 'idempotencyKey'), 'old-key'),
            (('postings', 1, 'amountKobo'), 10000), (('postings', 1, 'account'), 'principal'),
            (('aliases', 0, 'providerTransactionId'), 'old-native-transaction'),
            (('notifications', 0, 'eventKey'), 'first-contribution'),
            (('notifications', 0, 'voidedAt'), '2026-10-03T07:47:20Z'), (('activeLeaseCount',), False),
        ]
        for path, value in cases:
            with self.subTest(path=path):
                report = completed_fixture()
                change(report, path, value)
                with self.assertRaisesRegex(ValueError, '^financial_completion_refused$'):
                    MODULE.validate_completed(report)
    def test_bounded_collections_reject_missing_or_duplicate_rows(self):
        for key in ('evidence', 'queue', 'projections', 'ledgerOperations', 'contributions', 'postings', 'aliases', 'notifications'):
            for duplicate in (False, True):
                with self.subTest(key=key, duplicate=duplicate):
                    report = completed_fixture()
                    rows = report['nativeEvidence'][key] if key == 'evidence' else report[key]
                    if duplicate:
                        rows.append(copy.deepcopy(rows[0]))
                    else:
                        rows.clear()
                    with self.assertRaisesRegex(ValueError, '^financial_completion_refused$'):
                        MODULE.validate_completed(report)
    def test_coordinated_hash_replacement_does_not_change_original_receipt_pin(self):
        report = native_fixture()
        for container, fields in ((report['provenance'], ('payloadSha256',)),
                                  (report['receiptStorage'], ('payloadSha256', 'signaturePayloadSha256')),
                                  (report['evidence'][0], ('fingerprint',))):
            for field in fields:
                container[field] = '269d' + 'b' * 60
        with self.assertRaisesRegex(ValueError, '^native_evidence_refused$'):
            MODULE.validate_native_evidence(report)
    def test_nested_extra_fields_and_missing_identity_fields_refuse(self):
        for key in ('appIdentity', 'scope', 'provenance', 'receiptStorage', 'collection', 'crosswalk'):
            for extra in (False, True):
                with self.subTest(key=key, extra=extra):
                    report = native_fixture()
                    if extra:
                        report[key]['secret'] = 'never-echo'
                    else:
                        del report[key][next(iter(report[key]))]
                    with self.assertRaisesRegex(ValueError, '^native_evidence_refused$'):
                        MODULE.validate_native_evidence(report)
    def test_read_only_late_capture_does_not_allow_completion_writes_at_deadline(self):
        for path in (('goals', 0, 'completedAt'), ('queue', 0, 'finishedAt')):
            with self.subTest(path=path):
                report = completed_fixture()
                report['observedAt'] = '2026-10-07T00:00:00Z'
                refresh_native(report['nativeEvidence'], report['observedAt'])
                change(report, path, '2026-10-06T15:59:10Z')
                with self.assertRaisesRegex(ValueError, '^financial_completion_refused$'):
                    MODULE.validate_completed(report)
    def test_late_read_only_capture_accepts_only_predeadline_writes_and_fresh_audit(self):
        report = completed_fixture()
        report['observedAt'] = '2026-10-07T00:00:00Z'
        refresh_native(report['nativeEvidence'], report['observedAt'])
        self.assertTrue(MODULE.validate_completed(report)['financialProofPassed'])
        report['nativeEvidence']['provenance']['sourceProofObservedAt'] = '2026-10-06T23:58:59Z'
        with self.assertRaisesRegex(ValueError, '^financial_completion_refused$'):
            MODULE.validate_completed(report)
    def test_highest_milestone_or_first_key_matches_actual_target(self):
        for target, key, event_type in ((10000, 'milestone:100', 'goal_completed'),
                                       (11111, 'milestone:90', 'milestone'),
                                       (13333, 'milestone:75', 'milestone'),
                                       (20000, 'milestone:50', 'milestone'),
                                       (40000, 'milestone:25', 'milestone'),
                                       (40001, 'first-contribution', 'first_contribution')):
            with self.subTest(target=target):
                report = completed_fixture()
                report['goals'][0].update(targetKobo=target, status='completed' if target == 10000 else 'active',
                                          completedAt='2026-10-03T07:47:00Z' if target == 10000 else None)
                report['notifications'][0].update(eventKey=key, type=event_type)
                self.assertTrue(MODULE.validate_completed(report)['financialProofPassed'])
    def test_explicit_precommit_keeps_false_application_and_true_receipt_identity(self):
        report = completed_fixture()
        report.update(proofKind='financial_precommit', financialCommitted=False)
        report['appIdentity']['readOnly'] = False
        report['nativeEvidence'].update(proofKind='native_transfer_precommit', financialCommitted=False)
        report['nativeEvidence']['appIdentity']['readOnly'] = False
        original = copy.deepcopy(report)
        result = MODULE.validate_precommit(report)
        self.assertFalse(result['financialCommitted'])
        self.assertNotIn('financialProofPassed', result)
        self.assertEqual(report, original)
        with self.assertRaises(ValueError): MODULE.validate_completed(report)
        report['nativeEvidence']['receiptStorage']['identity']['readOnly'] = False
        with self.assertRaises(ValueError): MODULE.validate_precommit(report)
    def test_unknown_missing_and_malformed_fields_refuse_without_echoing_secrets(self):
        for validate, fixture, code in ((MODULE.validate_native_evidence, native_fixture, 'native_evidence_refused'),
                                        (MODULE.validate_completed, completed_fixture, 'financial_completion_refused')):
            for report in (None, [], {}, {'secret': 'never-echo'}, fixture()):
                if isinstance(report, dict) and 'schemaVersion' in report:
                    report['secret'] = 'never-echo'
                with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                    validate(report)
if __name__ == '__main__':
    unittest.main()
