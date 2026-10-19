import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch


SPEC = importlib.util.spec_from_file_location('worker_owner', Path(__file__).with_name('runtime-workers-owner.py'))
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


class WorkerOwnerTests(unittest.TestCase):
    def test_initial_passes_and_no_payment_proof_precede_scheduling(self):
        installer = MagicMock()
        OWNER.activate(installer)
        calls = [entry[0] for entry in installer.method_calls]
        self.assertEqual(calls, ['preflight', 'prepare', 'run_once', 'install_units', 'apply',
                                 'run_once', 'run_once', 'verify_no_payment', 'schedule'])
        self.assertEqual([entry.args for entry in installer.run_once.call_args_list],
                         [('readiness',), ('snapshot',), ('background',)])

    def test_failed_readiness_does_not_apply_sql_or_start_payment_worker(self):
        installer = MagicMock()
        installer.run_once.side_effect = OWNER.Refused('refused')
        with self.assertRaises(OWNER.Refused):
            OWNER.activate(installer)
        installer.apply.assert_not_called()
        installer.schedule.assert_not_called()
        self.assertEqual(installer.run_once.call_count, 1)

    def test_failed_snapshot_does_not_run_dispatch_or_schedule(self):
        installer = MagicMock()
        installer.run_once.side_effect = [None, OWNER.Refused('refused')]
        with self.assertRaises(OWNER.Refused):
            OWNER.activate(installer)
        installer.schedule.assert_not_called()
        self.assertEqual(installer.run_once.call_count, 2)


if __name__ == '__main__':
    unittest.main()
