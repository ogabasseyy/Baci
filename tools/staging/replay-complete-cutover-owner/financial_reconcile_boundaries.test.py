import copy
import completion_snapshot
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('reconcile_boundary_fixture', HERE/'financial_reconcile_pass.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
MODULE = FIXTURE.module


class FinancialReconcileBoundaryTests(FIXTURE.FinancialReconcilePassTests):
    def test_missing_completion_dependency_refuses_before_worker_start(self):
        self.pins.pop('completion_snapshot.py', None)
        self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_foreign_loaded_completion_validator_origin_refuses_before_worker_start(self):
        with patch.object(completion_snapshot, '__file__', '/tmp/completion_snapshot.py'):
            self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_completed_report_with_empty_protected_credit_never_claims_completion(self):
        for relation in FIXTURE.DELTA.INSERTIONS:
            witness = self.after['allowedTargetWitnesses'][relation]
            witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
            self.after['tableRows'][relation]['count'] = witness['excludedTargetCount']
        with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$') as caught:
            self.execute()
        evidence = caught.exception.private_evidence
        self.assertIn('final', evidence)
        self.assertNotIn('summary', evidence)
        self.assertEqual(len(self.worker.starts()), 1)

    def test_second_completed_assembly_rebinds_its_exact_final_snapshot(self):
        capture, assemble, observed, assemblies = MODULE._capture, MODULE.application_reports.assemble_completed, {}, 0
        def remember(*arguments):
            result = capture(*arguments)
            observed.update(result)
            return result
        def changed(*arguments):
            nonlocal assemblies
            report = assemble(*arguments)
            assemblies += 1
            if assemblies == 2:
                observed['protectedSnapshot']['allowedTargetWitnesses']['public.customer_savings_goals']\
                    ['targetRows'][0]['current_amount'] = 0
            return report
        with patch.object(MODULE, '_capture', side_effect=remember), \
            patch.object(MODULE.application_reports, 'assemble_completed', side_effect=changed):
            with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$') as caught:
                self.execute()
        self.assertEqual(assemblies, 2)
        self.assertNotIn('summary', caught.exception.private_evidence)
        self.assertEqual(len(self.worker.starts()), 1)

    def test_source_reverification_delay_refuses_before_any_worker_start(self):
        original_files, calls = MODULE._files, 0
        def delayed_files(*arguments):
            nonlocal calls
            calls += 1
            captured = original_files(*arguments)
            if calls == 2:
                self.worker.now += 61
            return captured
        with patch.object(MODULE, '_files', side_effect=delayed_files):
            self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_worker_input_verification_delay_refuses_at_start_boundary(self):
        original_read, delayed = self.context.owner.read, False
        def delayed_read(path, pin, **options):
            nonlocal delayed
            result = original_read(path, pin, **options)
            if str(path) == FIXTURE.authority.CONFIGURATION and not delayed:
                self.worker.now += 61
                delayed = True
            return result
        self.context.owner.read = delayed_read
        self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_preexisting_projection_cannot_be_accepted_as_unchanged_reconciliation(self):
        self.phase = 'projection'
        self.pending['completedApplication']['projections'] = copy.deepcopy(
            self.application['completedApplication']['projections'])
        relation = 'prefunded_card.projections'
        for snapshot in (self.before, self.after):
            snapshot['allowedTargetWitnesses'][relation].update(targetCount=1,
                targetRows=[{'operation_id': FIXTURE.natural.TARGET}],
                targetRowColumnHashes=[{'operation_id': 'a'*64}])
            snapshot['tableRows'][relation]['count'] += 1
        self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_each_partial_target_history_array_refuses_before_worker(self):
        for field in ('ledgerOperations', 'contributions', 'postings', 'aliases', 'notifications'):
            with self.subTest(field=field):
                self.setUp()
                self.pending['completedApplication'][field] = copy.deepcopy(
                    self.application['completedApplication'][field])
                self.refused()
                self.assertEqual(self.worker.starts(), [])

    def test_protected_target_witness_refuses_even_when_projection_report_is_empty(self):
        relation = 'piggyvest_savings_ledger.operations'
        self.before['allowedTargetWitnesses'][relation].update(targetCount=1,
            targetRows=[{'id': FIXTURE.natural.TARGET}], targetRowColumnHashes=[{'id': 'a'*64}])
        self.before['tableRows'][relation]['count'] += 1
        self.after = copy.deepcopy(self.before)
        self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_original_principal_or_opening_budget_mismatch_refuses_before_worker(self):
        for changed in ('old-principal', 'new-principal', 'opening', 'replenishment'):
            with self.subTest(changed=changed):
                self.setUp()
                report = self.pending['completedApplication']
                if changed.endswith('principal'):
                    goal_id = '430314fd-cd8b-4579-98d4-e9f345713dd6' if changed == 'old-principal' else '9f01153c-1589-4dde-b9aa-8f644a846832'
                    goal = next(value for value in report['goals'] if value['goalId'] == goal_id)
                    goal['displayedPrincipalKobo'] += 1
                elif changed == 'opening':
                    report['treasury']['openingAvailableKobo'] = 20000
                else:
                    report['treasury']['replenishedKobo'] = 1
                self.refused()
                self.assertEqual(self.worker.starts(), [])

    def test_intermediate_partial_history_never_authorizes_a_projection_followup(self):
        self.phase = 'projection'
        original_application = self.current_application
        def partially_applied():
            report = original_application()
            if self.worker.starts():
                report['completedApplication']['postings'] = copy.deepcopy(
                    self.application['completedApplication']['postings'])
            return report
        self.current_application = partially_applied
        self.refused()
        self.assertEqual(len(self.worker.starts()), 1)

    def test_failed_worker_retains_collected_post_state_without_exposing_it(self):
        self.worker.log = '{"status":"failed","secret":"do-not-print"}'
        with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$') as caught:
            self.execute()
        evidence = getattr(caught.exception, 'private_evidence', None)
        self.assertIsInstance(evidence, dict)
        self.assertTrue(evidence['workerFailed'])
        self.assertEqual(evidence['baseline'], self.before)
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertIn('delta', evidence)
        self.assertNotIn('do-not-print', str(caught.exception))
        self.assertEqual(len(self.worker.starts()), 1)

    def test_rejected_post_delta_still_retains_exact_observed_private_snapshot(self):
        self.after['permanentMetadataSha256'] = '1'*64
        with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$') as caught:
            self.execute()
        evidence = getattr(caught.exception, 'private_evidence', None)
        self.assertIsInstance(evidence, dict)
        self.assertEqual(evidence['firstPost'], self.after)
        self.assertNotIn('delta', evidence)
        self.assertNotIn('summary', evidence)
        self.assertEqual(len(self.worker.starts()), 1)

    def test_final_snapshot_drift_retains_the_snapshot_that_caused_refusal(self):
        original_capture, post_captures, observed = MODULE._capture, 0, {}
        def drifting_capture(*arguments):
            nonlocal post_captures
            report = original_capture(*arguments)
            if self.worker.starts():
                post_captures += 1
                if post_captures == 2:
                    report['protectedSnapshot']['permanentMetadataSha256'] = '2'*64
                    observed.update(copy.deepcopy(report))
            return report
        with patch.object(MODULE, '_capture', side_effect=drifting_capture):
            with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$') as caught:
                self.execute()
        evidence = getattr(caught.exception, 'private_evidence', None)
        self.assertIsInstance(evidence, dict)
        self.assertEqual(evidence.get('final'), observed['protectedSnapshot'])
        self.assertEqual(evidence.get('finalApplication'), observed['application'])
        self.assertNotIn('summary', evidence)
        self.assertEqual(len(self.worker.starts()), 1)

    def test_refreshed_native_evidence_is_retained_when_its_validation_refuses(self):
        original_stopped, collections = self.stopped, 0
        def changed_proof(*arguments):
            nonlocal collections
            collections += 1
            report = original_stopped(*arguments)
            if collections == 2:
                report['original']['provenance']['hmacSha512Verified'] = False
            return report
        self.stopped = changed_proof
        with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$') as caught:
            self.execute()
        evidence = getattr(caught.exception, 'private_evidence', None)
        self.assertIsInstance(evidence, dict)
        self.assertFalse(evidence['original']['provenance']['hmacSha512Verified'])
        self.assertIn('final', evidence)
        self.assertNotIn('summary', evidence)
        self.assertEqual(len(self.worker.starts()), 1)


if __name__ == '__main__':
    unittest.main()
