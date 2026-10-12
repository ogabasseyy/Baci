import copy
from contextlib import contextmanager
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import continuation_root as SUBJECT

SPEC = importlib.util.spec_from_file_location('runner_fixture', HERE/'continuation_runner.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class ContinuationRootTests(unittest.TestCase):
    def setUp(self):
        self.runner = FIXTURE.ContinuationRunnerTests()
        self.runner.setUp()
        self.addCleanup(self.runner.doCleanups)
        self.root = SUBJECT.Root.__new__(SUBJECT.Root)
        self.root.context, self.root.diagnostic = Mock(), Mock()
        self.root.closed, self.root.prepared = False, False
        self.root.owned_transaction, self.root.drain = None, None
        self.root.profile = {'worker': 'exact', 'unit': 'exact'}
        self.root.legacy = Mock()

        @contextmanager
        def scope():
            yield {'provider_preflight': Mock()}

        self.root.legacy.scope.side_effect = scope
        self.root._sources = Mock()
        self.root.journal = Mock()
        self.root._collect = Mock(return_value=self.runner.root.reconcile.return_value)
        self.root.original = dict(receiptStorage={'observedAt': 'fixture'},
            provenance={'sourceProofObservedAt': 'fixture'})
        self.root.provider = {}
        self.runner.root = self.root
        self.check = patch.object(SUBJECT.checks, 'guard', return_value=self.root.profile)
        self.checked = self.check.start()
        self.addCleanup(self.check.stop)
        self.binding = patch.object(SUBJECT, 'OwnedTransactionDrain')
        self.bound = self.binding.start()
        self.addCleanup(self.binding.stop)

    def prepare(self):
        self.root.prepared = True
        return dict(protectedSnapshot=self.runner.before, original={}, provider={})

    def test_actual_runner_flow_accepts_closed_owned_commit_only_for_readonly_final_guard(self):
        with patch.object(SUBJECT.Root, 'prepare', side_effect=self.prepare):
            result = self.runner.run_pass()
        self.assertEqual(result['status'], 'existing-payment-continuation-completed')
        self.assertTrue(result['commitAcknowledged'])
        self.assertIs(self.root.owned_transaction, self.runner.transaction)
        self.bound.assert_called_once_with(self.runner.transaction)
        self.assertIsNone(self.checked.call_args.args[3])
        self.runner.transaction.finish.assert_called_once_with(commit=True)

    def test_arbitrary_closed_unacknowledged_or_unclean_transaction_refuses(self):
        owned = self.runner.transaction
        self.root.prepared, self.root.owned_transaction = True, owned
        owned.closed = owned.commit_acknowledged = owned.cleanup_confirmed = True
        for selected in ('foreign', 'ack', 'cleanup', 'open'):
            with self.subTest(selected=selected):
                owned.closed = owned.commit_acknowledged = owned.cleanup_confirmed = True
                transaction = Mock(closed=True) if selected == 'foreign' else owned
                if selected != 'foreign':
                    setattr(owned, {'ack': 'commit_acknowledged', 'cleanup': 'cleanup_confirmed',
                        'open': 'closed'}[selected], False)
                with self.assertRaises(ValueError):
                    self.root.guard('completed-readback', transaction)

    def test_owned_binding_failure_rolls_back_without_mutation_or_retry(self):
        self.bound.side_effect = ValueError('owned_transaction_drain_refused')
        with patch.object(SUBJECT.Root, 'prepare', side_effect=self.prepare):
            result = self.runner.run_pass()
        self.assertFalse(result['commitAttempted'])
        self.assertFalse(result['automaticRetryAttempted'])
        self.runner.transaction.finish.assert_called_once_with(commit=False)
        self.assertEqual(len(self.runner.calls), 1)

    def test_prepare_refuses_any_latest_snapshot_rebaseline(self):
        self.root.after = dict(normal={'protectedSnapshot': copy.deepcopy(self.runner.before)})
        self.root._collect.return_value['protectedSnapshot']['permanentMetadataSha256'] = 'e' * 64
        with self.assertRaises(ValueError):
            self.root.prepare()
        self.assertFalse(self.root.prepared)

    def test_lock_cleanup_failure_is_not_hidden(self):
        self.root.context.lock = 91
        with patch.object(SUBJECT.os, 'close', side_effect=OSError('uncertain')) as close:
            with self.assertRaises(OSError):
                self.root.close()
        close.assert_called_once_with(91)
        self.assertTrue(self.root.closed)


if __name__ == '__main__':
    unittest.main()
