import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

import financial_delta


HERE = Path(__file__).resolve().parent


def fixture(name):
    specification = importlib.util.spec_from_file_location('snapshot_' + name, HERE/(name+'.test.py'))
    loaded = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(loaded)
    return loaded


REPORTS, DELTA = [fixture(name) for name in ('financial_completion', 'financial_delta')]

try:
    import completion_snapshot as module
except ModuleNotFoundError:
    module = None


def consistent_snapshot(report=None):
    report = report or REPORTS.completed_fixture()
    snapshot = DELTA.snapshot()
    snapshot.update(readOnly=True, capturedAt=report['observedAt'])
    operation, treasury, goal = report['operation'], report['treasury'], next(
        row for row in report['goals'] if row['goalId'] == REPORTS.GOAL)
    projection, contribution, notification = [report[name][0] for name in ('projections', 'contributions', 'notifications')]
    rows = {
        'prefunded_card.operations': [dict(id=operation['operationId'], integration_id=REPORTS.INTEGRATION,
            merchant_id=REPORTS.MERCHANT, customer_id=REPORTS.CUSTOMER, goal_id=REPORTS.GOAL,
            treasury_binding_id=REPORTS.TREASURY, amount_kobo=10000, currency='NGN',
            destination_wallet_id=REPORTS.DESTINATION, destination_customer_id=REPORTS.PROVIDER_CUSTOMER,
            collection_status='verified_success', transfer_status='verified_success', projection_status='applied',
            collection_provider_transaction_id=operation['collectionProviderTransactionId'],
            transfer_provider_transaction_id=REPORTS.TRANSACTION, checkout_retired=False,
            verification_lease_expires_at=None, transfer_attempted_at=operation['transferAttemptedAt'])],
        'prefunded_card.checkout_intents': [dict(operation_id=REPORTS.OPERATION,
            phase=operation['intentPhase'], initialization_lease_expires_at=None)],
        'prefunded_card.dispatch_queue': [dict(operation_id=REPORTS.OPERATION, lease_expires_at=None,
            finished_at=report['queue'][0]['finishedAt'])],
        'prefunded_card.treasury_bindings': [dict(id=REPORTS.TREASURY, integration_id=REPORTS.INTEGRATION,
            expected_business_id=REPORTS.BUSINESS, source_wallet_id=REPORTS.SOURCE,
            reserved_kobo=treasury['reservedKobo'], consumed_kobo=treasury['consumedKobo'])],
        'public.customer_savings_goals': [dict(id=REPORTS.GOAL, merchant_id=REPORTS.MERCHANT,
            customer_id=REPORTS.CUSTOMER, current_amount=100, target_amount=goal['targetKobo']/100,
            status=goal['status'], completed_at=goal['completedAt'])],
        'prefunded_card.projections': [dict(operation_id=REPORTS.OPERATION, ledger_operation_id=REPORTS.OPERATION,
            amount_kobo=10000, contribution_id=projection['contributionId'], created_at=projection['createdAt'])],
        'piggyvest_savings_ledger.operations': [dict(id=REPORTS.OPERATION, goal_id=REPORTS.GOAL,
            integration_id=REPORTS.INTEGRATION, merchant_id=REPORTS.MERCHANT, customer_id=REPORTS.CUSTOMER,
            evidence_id=REPORTS.KEY, reference_id=None)],
        'piggyvest_savings_ledger.postings': [dict(operation_id=REPORTS.OPERATION,
            account=row['account'], amount_kobo=row['amountKobo']) for row in report['postings']],
        'public.customer_savings_contributions': [dict(id=contribution['contributionId'], goal_id=REPORTS.GOAL,
            merchant_id=REPORTS.MERCHANT, customer_id=REPORTS.CUSTOMER, amount=100,
            source_type='paystack_authorization', status='completed', idempotency_key=REPORTS.KEY)],
        'prefunded_card.provider_aliases': [dict(integration_id=REPORTS.INTEGRATION,
            provider_transaction_id=REPORTS.TRANSACTION, operation_id=REPORTS.OPERATION)],
        'savings_notifications.events': [dict(id=notification['notificationId'], goal_id=REPORTS.GOAL,
            merchant_id=REPORTS.MERCHANT, customer_id=REPORTS.CUSTOMER,
            event_key=notification['eventKey'], type=notification['type'], voided_at=None)],
        'savings_notifications.deliveries': [],
    }
    for relation, values in rows.items():
        columns = [{key: hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()
            for key, value in row.items()} for row in values]
        hidden = {'prefunded_card.operations': 'verification_token',
            'prefunded_card.dispatch_queue': 'claim_token',
            'prefunded_card.checkout_intents': 'initialization_token'}.get(relation)
        if hidden:
            columns[0][hidden] = hashlib.sha256(b'null').hexdigest()
        if relation == 'piggyvest_savings_ledger.operations':
            command = dict(operationId=REPORTS.OPERATION, kind='credit_principal', principalKobo=10000,
                interestKobo=0, evidenceId=REPORTS.KEY, referenceId=None)
            columns[0]['command'] = postgres_object_hash(command)
        if relation == 'public.customer_savings_contributions':
            metadata = dict(funding_model='prefunded_piggyvest', operation_id=REPORTS.OPERATION,
                transfer_reference=REPORTS.REFERENCE, provider_transaction_id=REPORTS.TRANSACTION)
            columns[0]['metadata'] = postgres_object_hash(metadata)
        witness = snapshot['allowedTargetWitnesses'][relation]
        witness.update(targetCount=len(values), targetRows=values, targetRowColumnHashes=columns)
        snapshot['tableRows'][relation]['count'] = witness['excludedTargetCount']+len(values)
    return snapshot


def postgres_object_hash(value):
    ordered = dict(sorted(value.items(), key=lambda item: (len(item[0].encode()), item[0].encode())))
    return hashlib.sha256(json.dumps(ordered, ensure_ascii=False, separators=(', ', ': ')).encode()).hexdigest()


def reminder_row():
    return dict(id='914e9941-c9c1-44a1-9879-1de3e54ac365', goal_id=REPORTS.GOAL,
        merchant_id=REPORTS.MERCHANT, customer_id=REPORTS.CUSTOMER,
        event_key='missed:2026-10-02', type='missed_contribution',
        created_at='2026-10-03T16:40:14.266867+00:00', read_at=None, voided_at=None,
        due_period_start='2026-10-02T00:00:00+00:00', push_expanded_at='2026-10-03T16:40:15+00:00')


def append_reminder(snapshot):
    row = reminder_row()
    witness = snapshot['allowedTargetWitnesses']['savings_notifications.events']
    witness['targetRows'].append(row)
    witness['targetRowColumnHashes'].append({key: hashlib.sha256(
        json.dumps(value, separators=(',', ':')).encode()).hexdigest() for key, value in row.items()})
    witness['targetCount'] += 1
    snapshot['tableRows']['savings_notifications.events']['count'] += 1
    return row


class CompletionSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'completion-to-protected-snapshot binding is missing')
        self.report = REPORTS.completed_fixture()
        self.snapshot = consistent_snapshot(self.report)

    def refused(self):
        with self.assertRaisesRegex(ValueError, '^completion_snapshot_refused$'):
            module.verify_completion_snapshot(self.report, self.snapshot)

    def test_completed_report_requires_matching_protected_credit_and_preserves_inputs(self):
        before = copy.deepcopy((self.report, self.snapshot))
        self.assertTrue(module.verify_completion_snapshot(self.report, self.snapshot)['snapshotCompletionBound'])
        self.assertEqual(before, (self.report, self.snapshot))

    def test_completed_report_with_unapplied_empty_snapshot_is_rejected(self):
        for relation in financial_delta.INSERTIONS:
            witness = self.snapshot['allowedTargetWitnesses'][relation]
            witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
            self.snapshot['tableRows'][relation]['count'] = witness['excludedTargetCount']
        self.refused()

    def test_applied_report_cannot_hide_unapplied_operation_or_unfunded_goal(self):
        for relation, field, value in (
            ('prefunded_card.operations', 'projection_status', 'unapplied'),
            ('public.customer_savings_goals', 'current_amount', 0),
            ('prefunded_card.treasury_bindings', 'consumed_kobo', 0),
            ('public.customer_savings_contributions', 'amount', 1),
            ('piggyvest_savings_ledger.postings', 'amount_kobo', 1),
            ('prefunded_card.provider_aliases', 'provider_transaction_id', 'foreign')):
            with self.subTest(relation=relation):
                self.setUp()
                self.snapshot['allowedTargetWitnesses'][relation]['targetRows'][0][field] = value
                self.refused()

    def test_redacted_token_hashes_cannot_hide_active_leases(self):
        for relation, field in (
            ('prefunded_card.operations', 'verification_token'),
            ('prefunded_card.dispatch_queue', 'claim_token'),
            ('prefunded_card.checkout_intents', 'initialization_token')):
            with self.subTest(relation=relation):
                self.setUp()
                self.snapshot['allowedTargetWitnesses'][relation]['targetRowColumnHashes'][0][field] = 'f'*64
                self.refused()

    def test_redacted_command_or_metadata_cannot_disagree_with_authenticated_completion(self):
        for relation, field in (('piggyvest_savings_ledger.operations', 'command'),
            ('public.customer_savings_contributions', 'metadata')):
            with self.subTest(relation=relation):
                self.setUp()
                self.snapshot['allowedTargetWitnesses'][relation]['targetRowColumnHashes'][0][field] = 'f'*64
                self.refused()

    def test_duplicate_notification_or_posting_is_not_a_single_credit(self):
        for relation in ('savings_notifications.events', 'piggyvest_savings_ledger.postings'):
            with self.subTest(relation=relation):
                self.setUp()
                witness = self.snapshot['allowedTargetWitnesses'][relation]
                witness['targetRows'].append(copy.deepcopy(witness['targetRows'][0]))
                witness['targetRowColumnHashes'].append(copy.deepcopy(witness['targetRowColumnHashes'][0]))
                witness['targetCount'] += 1
                self.snapshot['tableRows'][relation]['count'] += 1
                self.refused()

    def test_equivalent_utc_timestamp_forms_match_without_relaxing_identity(self):
        projection = self.snapshot['allowedTargetWitnesses']['prefunded_card.projections']['targetRows'][0]
        projection['created_at'] = projection['created_at'].replace('Z', '+00:00')
        self.assertTrue(module.verify_completion_snapshot(self.report, self.snapshot)['snapshotCompletionBound'])


class PrecommitSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.report = REPORTS.completed_fixture()
        self.report.update(proofKind='financial_precommit', financialCommitted=False)
        self.report['appIdentity']['readOnly'] = False
        self.report['nativeEvidence'].update(proofKind='native_transfer_precommit', financialCommitted=False)
        self.report['nativeEvidence']['appIdentity']['readOnly'] = False
        self.snapshot = consistent_snapshot(self.report)
        self.snapshot['readOnly'] = False

    def test_real_transaction_snapshot_is_bound_without_readonly_normalization(self):
        original = copy.deepcopy((self.report, self.snapshot))
        result = module.verify_precommit_snapshot(self.report, self.snapshot)
        self.assertIs(result['financialCommitted'], False)
        self.assertNotIn('financialProofPassed', result)
        self.assertEqual((self.report, self.snapshot), original)
        self.assertEqual(self.snapshot['identity'], original[1]['identity'])
        self.assertNotIn('readOnly', self.snapshot['identity'])
        with self.assertRaises(ValueError):
            module.verify_completion_snapshot(self.report, self.snapshot)

    def test_precommit_rejects_readonly_snapshot_or_mismatched_actual_credit(self):
        for flag in (True, 0, None):
            self.snapshot['readOnly'] = flag
            with self.assertRaises(ValueError):
                module.verify_precommit_snapshot(self.report, self.snapshot)
        self.snapshot['readOnly'] = False
        self.snapshot['allowedTargetWitnesses']['piggyvest_savings_ledger.postings']['targetRows'][0]['amount_kobo'] = 1
        with self.assertRaises(ValueError):
            module.verify_precommit_snapshot(self.report, self.snapshot)

    def test_snapshot_precommit_rejects_readonly_report_or_committed_proof_kind(self):
        for flag in (True, 0, None):
            self.report['appIdentity']['readOnly'] = flag
            with self.assertRaises(ValueError):
                module.verify_precommit_snapshot(self.report, self.snapshot)
        self.report['appIdentity']['readOnly'] = False
        self.report['proofKind'] = 'financial_completion'
        with self.assertRaises(ValueError):
            module.verify_precommit_snapshot(self.report, self.snapshot)

    def test_known_reminder_is_preserved_in_actual_full_precommit_witness(self):
        reminder = copy.deepcopy(append_reminder(self.snapshot))
        original = copy.deepcopy(self.snapshot)
        proof = module.verify_precommit_snapshot(self.report, self.snapshot, preserved_notifications=[reminder])
        self.assertTrue(proof['snapshotPrecommitBound'])
        self.assertEqual(self.snapshot, original)
        durable_snapshot = copy.deepcopy(self.snapshot)
        durable_snapshot['readOnly'] = True
        proof = module.verify_completion_snapshot(REPORTS.completed_fixture(), durable_snapshot,
            preserved_notifications=[reminder])
        self.assertTrue(proof['snapshotCompletionBound'])
        with self.assertRaises(ValueError):
            module.verify_precommit_snapshot(self.report, self.snapshot)

    def test_missing_changed_foreign_or_extra_reminder_refuses(self):
        reminder = copy.deepcopy(append_reminder(self.snapshot))
        witness = self.snapshot['allowedTargetWitnesses']['savings_notifications.events']
        for field, value in (('type', 'contribution_received'), ('read_at', '2026-10-03T17:00:00Z'),
            ('id', 'b5c93597-2989-45d9-bed4-85ec220e4240'), ('push_expanded_at', None)):
            original = witness['targetRows'][1][field]
            witness['targetRows'][1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.verify_precommit_snapshot(self.report, self.snapshot, preserved_notifications=[reminder])
            witness['targetRows'][1][field] = original
        for rows in ([dict(reminder, type='unknown')], [reminder, reminder]):
            with self.assertRaises(ValueError):
                module.verify_precommit_snapshot(self.report, self.snapshot, preserved_notifications=rows)


class HashFormatPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_type = fixture('financial_snapshot').FIXTURE.ClaimFencePostgresTests
        cls.fixture_type.setUpClass()
        cls.addClassCleanup(cls.fixture_type.tearDownClass)

    def test_exact_reviewed_command_and_metadata_hashes_match_real_postgres_jsonb(self):
        harness = self.fixture_type('runTest')
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        values = (
            dict(operationId=REPORTS.OPERATION, kind='credit_principal', principalKobo=10000,
                interestKobo=0, evidenceId=REPORTS.KEY, referenceId=None),
            dict(funding_model='prefunded_piggyvest', operation_id=REPORTS.OPERATION,
                transfer_reference=REPORTS.REFERENCE, provider_transaction_id=REPORTS.TRANSACTION))
        for value in values:
            with self.subTest(fields=sorted(value)):
                literal = json.dumps(value).replace("'", "''")
                result = harness.sql("BEGIN READ ONLY; SELECT encode(sha256(convert_to('" + literal
                    + "'::jsonb::text,'UTF8')),'hex'); ROLLBACK;").stdout.strip()
                self.assertEqual(result, module._object_hash(value))


if __name__ == '__main__':
    unittest.main()
