import copy
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import application_reports
import financial_delta
import financial_reconcile_pass as finite
import natural_reclaim_authority as natural


HERE = Path(__file__).resolve().parent


def fixture(name):
    specification = importlib.util.spec_from_file_location('projection_' + name, HERE/(name+'.test.py'))
    loaded = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(loaded)
    return loaded


REPORTS, DELTA, SNAPSHOTS = [fixture(name) for name in ('application_reports', 'financial_delta', 'completion_snapshot')]

try:
    import projection_pass as module
except ModuleNotFoundError:
    module = None


class ProjectionPassTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'projection-only finite pass is missing')
        self.application, self.original, self.provider = REPORTS.inputs()
        completed = dict(schemaVersion=1, proofKind='financial_completion', observedAt=self.application['observedAt'],
            appIdentity=self.application['appIdentity'], nativeEvidence=SNAPSHOTS.REPORTS.native_fixture(),
            **self.application['completedApplication'])
        self.after = SNAPSHOTS.consistent_snapshot(completed)
        self.before = copy.deepcopy(self.after)
        for relation in financial_delta.INSERTIONS:
            witness = self.before['allowedTargetWitnesses'][relation]
            witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
            self.before['tableRows'][relation]['count'] = witness['excludedTargetCount']
        self.prepared = dict(baseline=self.before, applicationBefore=self.application,
            original=self.original, provider=self.provider,
            projectionTargetRowSha256=module.ROW_SHA256,
            catalogBefore=dict(catalogSha256=finite.REVIEWED_CATALOG_SHA256,
                capturedAt=self.application['observedAt']),
            backgroundBefore=dict(capturedAt=self.application['observedAt']),
            classificationBefore=dict(phase='apply_verified_projection'),
            summary=dict(status='projection-preflight-readonly-ready', actionAttempted=False,
                newPaymentStarted=False))
        self.captured = {name: name.encode() for name in module.FILES}
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.captured.items()}
        self.worker = dict(status='worker-source-inputs-bound', containerId=module.authority.BACKGROUND_CONTAINER_ID,
            manifestSha256=module.authority.MANIFEST_SHA256, approvedCompanyBudgetKobo=10000,
            approvedPreservedPrincipalKobo=10000, fileHashes={}, observedAt=self.application['observedAt'])
        self.events = []
        self.command = Mock(return_value='')
        self.context = SimpleNamespace(owner=SimpleNamespace(command=self.command), lock=10,
            deadline=Mock())
        self.adapter = Mock()
        self.adapter.run_once.side_effect = self.run_once
        self.failure = None
        self.post_collection_error = None
        self.preflight_drift = False
        self.adapter_arguments = None
        self.raw_capture = Mock(side_effect=self.capture)

    def run_once(self):
        self.events.append('attempted')
        self.adapter_arguments['run'](['/usr/bin/systemctl', 'start', module.worker_adapter.SERVICE], timeout=500)
        self.events.append('started')
        if self.failure:
            raise ValueError(self.failure)
        return dict(status='background-oneshot-completed')

    def preflight(self, *arguments):
        self.events.append('prepared')
        result = copy.deepcopy(self.prepared)
        if self.preflight_drift and 'attempted' in self.events:
            result['baseline']['permanentMetadataSha256'] = '1'*64
        return result

    def make_adapter(self, **arguments):
        self.adapter_arguments = arguments
        return self.adapter

    def capture(self, *arguments):
        self.events.append('captured')
        return dict(application=copy.deepcopy(self.application), protectedSnapshot=copy.deepcopy(self.after))

    def bundle(self, *arguments):
        if self.post_collection_error:
            raise ValueError(self.post_collection_error)
        return dict(original=copy.deepcopy(self.original), provider=copy.deepcopy(self.provider))

    def execute(self):
        observed = datetime.fromisoformat(self.application['observedAt'].replace('Z', '+00:00'))
        class Clock(datetime):
            @classmethod
            def now(cls, zone=None):
                return observed.astimezone(zone or timezone.utc)
        with ExitStack() as stack:
            stack.enter_context(patch.object(application_reports, 'datetime', Clock))
            stack.enter_context(patch.object(module, '_files', return_value=self.captured))
            stack.enter_context(patch.object(module.readiness, '_locked'))
            stack.enter_context(patch.object(module.readiness, '_fresh'))
            stack.enter_context(patch.object(module.preflight, 'collect_projection_preflight', side_effect=self.preflight))
            stack.enter_context(patch.object(module.worker_owner, 'collect_worker_authority', return_value=(self.worker, object())))
            stack.enter_context(patch.object(module.finite, '_worker_reader', return_value=Mock()))
            stack.enter_context(patch.object(module.finite, '_quiet', return_value=True))
            stack.enter_context(patch.object(module.finite, '_capture', side_effect=self.capture))
            stack.enter_context(patch.object(module.application_reports, 'capture_application', self.raw_capture))
            stack.enter_context(patch.object(module.finite, '_bundle', side_effect=self.bundle))
            stack.enter_context(patch.object(module.finite, '_catalog', return_value=self.prepared['catalogBefore']))
            stack.enter_context(patch.object(module.worker_adapter, 'WorkerAdapter', side_effect=self.make_adapter))
            return module.run_projection_pass(self.context, HERE, self.pins)

    def refused(self):
        with self.assertRaisesRegex(ValueError, '^projection_pass_refused$') as caught:
            self.execute()
        return caught.exception.private_evidence

    def test_projection_pass_starts_once_and_requires_complete_actual_financial_report(self):
        result = self.execute()
        self.assertEqual(result['summary']['status'], 'existing-payment-financially-completed')
        self.assertTrue(result['summary']['financialCompleted'])
        self.assertFalse(result['summary']['newPaymentStarted'])
        self.assertEqual(result['completedReport']['operation']['operationId'], natural.TARGET)
        self.adapter.run_once.assert_called_once()
        self.assertLess(self.events.index('prepared'), self.events.index('started'))
        self.raw_capture.assert_not_called()

    def test_wrong_preflight_phase_or_row_pin_refuses_without_starting(self):
        for field, value in (('classificationBefore', dict(phase='verify_existing_transfer')),
            ('projectionTargetRowSha256', 'f'*64)):
            with self.subTest(field=field):
                self.setUp()
                self.prepared[field] = value
                self.refused()
                self.adapter.run_once.assert_not_called()

    def test_failed_worker_retains_actual_post_state_and_never_retries(self):
        self.failure = 'PRIVATE_TOKEN'
        evidence = self.refused()
        self.assertTrue(evidence['workerFailed'])
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertEqual(evidence['firstPostApplication'], self.application)
        self.assertNotIn('summary', evidence)
        self.adapter.run_once.assert_called_once()

    def test_failed_unit_retains_raw_readonly_post_when_quiescent_capture_would_refuse(self):
        self.failure = 'worker_exit_nonzero'
        self.capture = Mock(side_effect=ValueError('financial_quiescence_refused'))
        self.bundle = Mock(side_effect=AssertionError('failed worker must not collect completion evidence'))
        with patch.object(module.application_reports, 'assemble_completed') as completed:
            evidence = self.refused()
        self.assertTrue(evidence['workerFailed'])
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertEqual(evidence['firstPostApplication'], self.application)
        self.assertIn('delta', evidence)
        for field in ('summary', 'completedReport', 'snapshotCompletion'):
            self.assertNotIn(field, evidence)
        self.capture.assert_not_called()
        self.raw_capture.assert_called_once_with(self.context, HERE/'financial_report.sql',
            self.pins['financial_report.sql'], HERE/'financial_snapshot.sql', self.pins['financial_snapshot.sql'])
        self.bundle.assert_not_called()
        completed.assert_not_called()
        self.adapter.run_once.assert_called_once()
        self.command.assert_called_once_with(
            ['/usr/bin/systemctl', 'start', module.worker_adapter.SERVICE], timeout=500)

    def test_failed_worker_retains_raw_snapshot_before_strict_delta_refusal(self):
        self.failure = 'worker_exit_nonzero'
        self.after['permanentMetadataSha256'] = '1'*64
        evidence = self.refused()
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertEqual(evidence['firstPostApplication'], self.application)
        self.assertNotIn('delta', evidence)
        self.assertNotIn('summary', evidence)
        self.raw_capture.assert_called_once()
        self.adapter.run_once.assert_called_once()

    def test_failed_worker_with_unavailable_raw_collector_refuses_without_completion_or_retry(self):
        self.failure = 'worker_exit_nonzero'
        self.raw_capture.side_effect = ValueError('PRIVATE_DATABASE_FAILURE')
        evidence = self.refused()
        self.assertTrue(evidence['workerFailed'])
        self.assertEqual(evidence['baseline'], self.before)
        for field in ('firstPost', 'summary', 'completedReport', 'snapshotCompletion'):
            self.assertNotIn(field, evidence)
        self.raw_capture.assert_called_once()
        self.adapter.run_once.assert_called_once()

    def test_incomplete_projection_report_is_not_financial_completion(self):
        self.application['completedApplication']['operation']['projectionStatus'] = 'unapplied'
        evidence = self.refused()
        self.assertEqual(evidence['finalApplication'], self.application)
        self.assertNotIn('summary', evidence)
        self.adapter.run_once.assert_called_once()

    def test_unrelated_post_change_is_retained_before_delta_refusal(self):
        self.after['permanentMetadataSha256'] = '1'*64
        evidence = self.refused()
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertNotIn('delta', evidence)
        self.adapter.run_once.assert_called_once()

    def test_projection_cannot_mutate_treasury_even_if_general_delta_allows_it(self):
        name = 'prefunded_card.treasury_bindings'
        self.after['tableRows'][name]['sha256'] = '1'*64
        self.after['allowedTargetWitnesses'][name]['targetRowColumnHashes'][0]['reserved_kobo'] = '2'*64
        evidence = self.refused()
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertNotIn('summary', evidence)

    def test_post_provider_failure_retains_first_post_and_avoids_completion_claim(self):
        self.post_collection_error = 'PRIVATE_PROVIDER_RESPONSE'
        evidence = self.refused()
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertNotIn('summary', evidence)
        self.adapter.run_once.assert_called_once()

    def test_changed_protected_state_at_actual_start_boundary_never_starts_service(self):
        self.preflight_drift = True
        evidence = self.refused()
        self.assertTrue(evidence['workerFailed'])
        self.command.assert_not_called()
        self.assertNotIn('started', self.events)

    def test_start_boundary_snapshot_drift_retains_the_fresh_preflight_before_refusal(self):
        self.preflight_drift = True
        evidence = self.refused()
        expected = copy.deepcopy(self.prepared)
        expected['baseline']['permanentMetadataSha256'] = '1'*64
        self.assertEqual(evidence.get('startBoundaryPreflight'), expected)
        self.command.assert_not_called()
        self.adapter.run_once.assert_called_once()

    def test_start_boundary_invalid_phase_retains_the_fresh_preflight_before_validation(self):
        original_preflight = self.preflight
        def invalid_boundary(*arguments):
            result = original_preflight(*arguments)
            if 'attempted' in self.events:
                result['classificationBefore']['phase'] = 'verify_existing_transfer'
            return result
        self.preflight = invalid_boundary
        evidence = self.refused()
        expected = copy.deepcopy(self.prepared)
        expected['classificationBefore']['phase'] = 'verify_existing_transfer'
        self.assertEqual(evidence.get('startBoundaryPreflight'), expected)
        self.command.assert_not_called()
        self.adapter.run_once.assert_called_once()

    def test_completed_report_with_empty_posting_snapshot_never_claims_completion(self):
        relation = 'piggyvest_savings_ledger.postings'
        witness = self.after['allowedTargetWitnesses'][relation]
        witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
        self.after['tableRows'][relation]['count'] = witness['excludedTargetCount']
        evidence = self.refused()
        self.assertIn('completedReport', evidence)
        self.assertNotIn('summary', evidence)


if __name__ == '__main__':
    unittest.main()
