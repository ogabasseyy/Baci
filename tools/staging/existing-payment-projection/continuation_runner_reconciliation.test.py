import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('reconciliation_fixture', HERE/'continuation_runner.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class ContinuationReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.runner = FIXTURE.ContinuationRunnerTests()
        self.runner.setUp()
        self.addCleanup(self.runner.doCleanups)

    def test_rollback_after_precommit_requires_unchanged_baseline_not_completed_report(self):
        self.runner.guards.side_effect = [None, None, ValueError('commit guard refused'), None]
        self.runner.root.reconcile.return_value['protectedSnapshot'] = copy.deepcopy(self.runner.before)
        reports = self.runner.modules['application_reports']
        with patch.object(reports, 'assemble_completed') as completed:
            result = self.runner.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-unconfirmed')
        self.assertFalse(result['commitAttempted'])
        self.assertFalse(result['reconciledFinancialCompleted'])
        self.runner.transaction.finish.assert_called_once_with(commit=False)
        completed.assert_not_called()
        evidence = self.runner.root.journal.call_args.args[1]
        self.assertTrue(evidence['reconciliation'].get('unchanged'))
        self.assertFalse(result['automaticRetryAttempted'])

    def test_rollback_readback_drift_does_not_claim_unchanged_or_financial_completion(self):
        self.runner.guards.side_effect = [None, None, ValueError('commit guard refused'), None]
        snapshot = copy.deepcopy(self.runner.before)
        snapshot['permanentMetadataSha256'] = 'e' * 64
        self.runner.root.reconcile.return_value['protectedSnapshot'] = snapshot
        reports = self.runner.modules['application_reports']
        with patch.object(reports, 'assemble_completed') as completed:
            result = self.runner.run_pass()
        self.assertFalse(result['commitAttempted'])
        self.assertFalse(result['financialCompleted'])
        self.assertFalse(result['reconciledFinancialCompleted'])
        completed.assert_not_called()
        evidence = self.runner.root.journal.call_args.args[1]
        self.assertNotIn('unchanged', evidence['reconciliation'])
        self.runner.transaction.finish.assert_called_once_with(commit=False)


if __name__ == '__main__':
    unittest.main()
