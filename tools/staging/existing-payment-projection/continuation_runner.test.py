import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'replay-complete-cutover-owner'))
sys.path.insert(0, str(HERE))


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


FIXTURE = load('continuation_fixture', HERE / 'projection_fence.test.py')


class ContinuationRunnerTests(unittest.TestCase):
    def setUp(self):
        self.subject = load('continuation_runner', HERE / 'continuation_runner.py')
        import application_reports
        import completion_snapshot
        import financial_delta
        import inspection_sql
        import projection_fence
        import projection_sql
        self.modules = {module.__name__: module for module in (application_reports,
            completion_snapshot, financial_delta, inspection_sql, projection_fence, projection_sql)}
        self.before, self.after, self.report = FIXTURE.states()
        self.completed = copy.deepcopy(self.report)
        self.completed.update(proofKind='financial_completion')
        del self.completed['financialCommitted']
        self.completed['appIdentity']['readOnly'] = True
        self.completed['nativeEvidence'].update(proofKind='native_transfer')
        del self.completed['nativeEvidence']['financialCommitted']
        self.completed['nativeEvidence']['appIdentity']['readOnly'] = True
        self.final = copy.deepcopy(self.after)
        self.final['readOnly'] = True
        self.root = Mock()
        self.root.prepare.return_value = dict(protectedSnapshot=self.before, original={}, provider={})
        self.root.reconcile.return_value = dict(protectedSnapshot=self.final,
            application={}, original={}, provider={})
        self.transaction = Mock(commit_attempted=False, commit_acknowledged=False,
            cleanup_confirmed=True, closed=False)
        self.calls = []

        def execute(sql):
            self.calls.append(sql)
            if sql == 'inspection':
                return [json.dumps(dict(kind='application', value={})),
                    json.dumps(dict(kind='snapshot', value=self.after))]
            return []

        def finish(*, commit):
            self.transaction.commit_attempted = self.transaction.commit_acknowledged = commit
            self.transaction.closed = True

        self.transaction.execute.side_effect = execute
        self.transaction.finish.side_effect = finish
        self.modules['psql_transaction'] = Mock(PsqlTransaction=Mock(return_value=self.transaction))
        self.captured = {'financial_report.sql': b'application', 'financial_snapshot.sql': b'snapshot'}
        self.guards = Mock()
        self.patches = [patch.object(application_reports, 'assemble_precommit', return_value=self.report),
            patch.object(application_reports, 'assemble_completed', return_value=self.completed),
            patch.object(application_reports, '_fresh'),
            patch.object(inspection_sql, 'inspection_sql', side_effect=['inspection', '']),
            patch.object(self.subject, '_deadline')]
        for active in self.patches:
            active.start()
            self.addCleanup(active.stop)

    def run_pass(self):
        return self.subject.run_continuation(self.root, self.modules, self.captured, self.guards)

    def test_commit_requires_bound_precommit_then_independent_completion(self):
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-completed')
        self.assertTrue(result['financialCommitted'])
        self.assertFalse(result['newPaymentStarted'])
        self.assertFalse(result['automaticRetryAttempted'])
        self.transaction.finish.assert_called_once_with(commit=True)
        self.root.reconcile.assert_called_once_with()
        self.assertIn('SET CONSTRAINTS ALL IMMEDIATE;', self.calls[1])
        self.assertNotIn('COMMIT;', ''.join(self.calls))

    def test_treasury_drift_rolls_back_without_commit_or_retry(self):
        self.after['tableRows']['prefunded_card.treasury_bindings']['sha256'] = 'd' * 64
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.transaction.finish.assert_called_once_with(commit=False)
        self.root.reconcile.assert_called_once_with()

    def test_missing_root_prerequisite_never_opens_transaction(self):
        self.root.prepare.side_effect = ValueError('missing repair/continuity proof')
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-refused')
        self.modules['psql_transaction'].PsqlTransaction.assert_not_called()

    def test_commit_ack_loss_reconciles_once_and_never_retries(self):
        def lost_ack(*, commit):
            self.transaction.commit_attempted = commit
            self.transaction.closed = True
            raise ValueError('psql_transaction_unconfirmed')
        self.transaction.finish.side_effect = lost_ack
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.assertTrue(result['reconciledFinancialCompleted'])
        self.assertIsNone(result['financialCommitted'])
        self.transaction.finish.assert_called_once_with(commit=True)

    def test_acknowledged_commit_cleanup_uncertainty_is_not_success(self):
        def uncertain_cleanup(*, commit):
            self.transaction.commit_attempted = self.transaction.commit_acknowledged = commit
            self.transaction.cleanup_confirmed = False
            self.transaction.closed = True
            raise ValueError('psql_transaction_unconfirmed')
        self.transaction.finish.side_effect = uncertain_cleanup
        result = self.run_pass()
        self.assertTrue(result['commitAcknowledged'])
        self.assertFalse(result['localCleanupConfirmed'])
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')

    def test_extra_inspection_record_and_final_snapshot_drift_refuse(self):
        self.transaction.execute.side_effect = [[], [], ['{}', '{}', '{}']]
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.transaction.finish.assert_called_once_with(commit=False)

    def test_final_readonly_drift_prevents_completion_after_commit(self):
        self.final['permanentMetadataSha256'] = 'e' * 64
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.assertTrue(result['commitAcknowledged'])

    def test_source_drift_at_commit_boundary_rolls_back(self):
        self.guards.side_effect = [None, None, ValueError('source changed')]
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.transaction.finish.assert_called_once_with(commit=False)

    def test_private_audit_failure_before_mutation_does_not_open_transaction(self):
        self.root.journal.side_effect = OSError('audit unavailable')
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-refused')
        self.assertFalse(result['privateAuditRecorded'])
        self.modules['psql_transaction'].PsqlTransaction.assert_not_called()

    def test_invalid_inspection_json_cannot_reach_commit(self):
        self.transaction.execute.side_effect = [[], [], [
            '{"kind":"application","kind":"snapshot","value":{}}',
            json.dumps(dict(kind='snapshot', value=self.after))]]
        result = self.run_pass()
        self.assertFalse(result['commitAttempted'])
        self.transaction.finish.assert_called_once_with(commit=False)

    def test_private_precommit_audit_failure_rolls_back_before_commit(self):
        self.root.journal.side_effect = [None, OSError('audit unavailable'), None]
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.transaction.finish.assert_called_once_with(commit=False)

    def test_final_audit_failure_preserves_ack_but_prevents_success(self):
        self.root.journal.side_effect = [None, None, OSError('audit unavailable')]
        result = self.run_pass()
        self.assertTrue(result['commitAcknowledged'])
        self.assertTrue(result['reconciledFinancialCompleted'])
        self.assertFalse(result['privateAuditRecorded'])
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')

    def test_commit_guard_receives_only_the_owned_transaction(self):
        self.run_pass()
        self.root.guard.assert_any_call('prepare', transaction=None)
        self.root.guard.assert_any_call('commit-boundary', transaction=self.transaction)

    def test_sql_failure_closes_without_a_second_mutation_attempt(self):
        self.transaction.execute.side_effect = [[], ValueError('42501')]
        self.root.reconcile.return_value['protectedSnapshot'] = self.before
        result = self.run_pass()
        self.assertEqual(self.transaction.execute.call_count, 2)
        self.transaction.finish.assert_called_once_with(commit=False)
        self.assertFalse(result['automaticRetryAttempted'])

    def test_incomplete_reminder_refuses_instead_of_rebaselining(self):
        relation = 'savings_notifications.events'
        previous = self.before['allowedTargetWitnesses'][relation]
        current = self.after['allowedTargetWitnesses'][relation]
        reminder = dict(current['targetRows'][0], id='914e9941-c9c1-44a1-9879-1de3e54ac365',
            type='missed_contribution', event_key='missed:2026-10-02')
        columns = copy.deepcopy(current['targetRowColumnHashes'][0])
        previous.update(targetCount=1, targetRows=[reminder], targetRowColumnHashes=[columns])
        self.before['tableRows'][relation]['count'] += 1
        current['targetCount'] += 1
        current['targetRows'].append(copy.deepcopy(reminder))
        current['targetRowColumnHashes'].append(copy.deepcopy(columns))
        self.after['tableRows'][relation]['count'] += 1
        original = copy.deepcopy(self.before)
        result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-refused')
        self.assertFalse(result['commitAttempted'])
        self.modules['psql_transaction'].PsqlTransaction.assert_not_called()
        self.assertEqual(self.before, original)

    def add_preserved_reminder(self):
        reminder = FIXTURE.FIXTURE.append_reminder(self.before)
        FIXTURE.FIXTURE.append_reminder(self.after)
        FIXTURE.FIXTURE.append_reminder(self.final)
        return reminder

    def test_preserved_reminder_is_passed_to_independent_completion_readback(self):
        reminder = self.add_preserved_reminder()
        completion = self.modules['completion_snapshot']
        with patch.object(completion, 'verify_completion_snapshot',
            wraps=completion.verify_completion_snapshot) as verify:
            result = self.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-completed')
        self.assertEqual(verify.call_args.kwargs['preserved_notifications'], [reminder])
        self.transaction.finish.assert_called_once_with(commit=True)

    def test_removed_modified_or_extra_reminder_rolls_back_precommit(self):
        for selected in ('removed', 'modified', 'type', 'extra'):
            with self.subTest(selected=selected):
                self.setUp()
                self.add_preserved_reminder()
                witness = self.after['allowedTargetWitnesses']['savings_notifications.events']
                if selected == 'removed':
                    witness['targetRows'].pop()
                    witness['targetRowColumnHashes'].pop()
                    witness['targetCount'] -= 1
                    self.after['tableRows']['savings_notifications.events']['count'] -= 1
                elif selected == 'extra':
                    extra = FIXTURE.FIXTURE.append_reminder(self.after)
                    extra['id'] = 'aaaaaaaa-0000-4000-8000-000000000001'
                else:
                    witness['targetRows'][1]['type' if selected == 'type' else 'push_expanded_at'] = None
                result = self.run_pass()
                self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
                self.assertFalse(result['commitAttempted'])
                self.transaction.finish.assert_called_once_with(commit=False)

    def test_independent_readback_cannot_drop_the_preserved_reminder(self):
        self.add_preserved_reminder()
        witness = self.final['allowedTargetWitnesses']['savings_notifications.events']
        witness['targetRows'].pop()
        witness['targetRowColumnHashes'].pop()
        witness['targetCount'] -= 1
        self.final['tableRows']['savings_notifications.events']['count'] -= 1
        result = self.run_pass()
        self.assertTrue(result['commitAcknowledged'])
        self.assertFalse(result['financialCompleted'])
        self.assertFalse(result['reconciledFinancialCompleted'])
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')

    def test_postcommit_actual_hidden_and_non_target_witness_drift_is_unconfirmed(self):
        relation = 'savings_notifications.events'
        for selected in ('unchanged', 'body', 'title', 'excludedTargetHash', 'excludedTargetCount'):
            with self.subTest(selected=selected):
                self.setUp()
                FIXTURE.install_actual_reminder(self.before, self.after, self.final)
                witness = self.final['allowedTargetWitnesses'][relation]
                if selected in ('body', 'title'):
                    witness['targetRowColumnHashes'][0][selected] = 'e' * 64
                elif selected == 'excludedTargetHash':
                    witness[selected] = 'e' * 64
                elif selected == 'excludedTargetCount':
                    witness[selected] += 1
                original = copy.deepcopy((self.before, self.after, self.final))
                completion = self.modules['completion_snapshot']
                with patch.object(completion, 'verify_completion_snapshot',
                    wraps=completion.verify_completion_snapshot) as verify:
                    result = self.run_pass()
                expected = selected == 'unchanged'
                self.assertEqual(result['financialCompleted'], expected)
                self.assertEqual(result['reconciledFinancialCompleted'], expected)
                self.assertEqual(result['status'], 'existing-payment-continuation-' +
                    ('completed' if expected else 'unconfirmed'))
                self.assertTrue(result['commitAcknowledged'])
                self.assertFalse(result['automaticRetryAttempted'])
                self.assertIs(result['financialCommitted'], True if expected else None)
                self.transaction.finish.assert_called_once_with(commit=True)
                self.root.reconcile.assert_called_once_with()
                if selected == 'excludedTargetCount':
                    verify.assert_not_called()
                else:
                    verify.assert_called_once()
                    self.assertEqual(verify.call_args.kwargs['preserved_notifications'],
                        self.before['allowedTargetWitnesses'][relation]['targetRows'])
                self.assertEqual((self.before, self.after, self.final), original)


if __name__ == '__main__':
    unittest.main()
