import importlib.util
from pathlib import Path
import sys
import subprocess
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('cutover_owner', HERE / 'replay-cutover-owner.py')
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


class Actions:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail

    def __getattr__(self, name):
        def action():
            self.calls.append(name)
            if name == self.fail:
                raise RuntimeError('secret must not escape')
        return action


class ReplayCutoverOwner(unittest.TestCase):
    def setUp(self):
        clock = patch.object(OWNER.time, 'time', return_value=1790500000)
        clock.start()
        self.addCleanup(clock.stop)

    def test_checks_before_stopping_and_enrolls_before_starting(self):
        actions = Actions()
        result = OWNER.activate(actions)
        self.assertEqual(actions.calls, ['preflight', 'prepare', 'readiness', 'rehearse', 'deadline',
                                        'stop_old', 'enroll', 'record_commit', 'start', 'verify'])
        self.assertFalse(result['cardPaymentsEnabled'])
        self.assertTrue(result['prefundedReplayEnabled'])

    def test_preflight_failure_never_stops_old_worker(self):
        actions = Actions('readiness')
        with self.assertRaises(OWNER.CutoverFailure) as caught:
            OWNER.activate(actions)
        self.assertNotIn('stop_old', actions.calls)
        self.assertEqual(caught.exception.stage, 'readiness')
        self.assertNotIn('secret', str(caught.exception))

    def test_unknown_database_outcome_does_not_restart_legacy_worker(self):
        actions = Actions('enroll')
        with self.assertRaises(OWNER.CutoverFailure) as caught:
            OWNER.activate(actions)
        self.assertTrue(caught.exception.old_stopped)
        self.assertIsNone(caught.exception.enrollment_committed)
        self.assertEqual(actions.calls[-1], 'enroll')

    def test_failure_after_commit_leaves_route_and_old_worker_stopped(self):
        for stage in ('record_commit', 'start', 'verify'):
            with self.subTest(stage=stage):
                actions = Actions(stage)
                with self.assertRaises(OWNER.CutoverFailure) as caught:
                    OWNER.activate(actions)
                self.assertTrue(caught.exception.enrollment_committed)
                self.assertNotIn('restore_legacy', actions.calls)

    def test_stop_timeout_reports_unknown_without_enrolling_or_restarting(self):
        actions = Actions()
        with patch.object(actions, 'stop_old', side_effect=subprocess.TimeoutExpired(
                ['docker', 'stop'], 30, output='secret', stderr='secret')):
            with self.assertRaises(OWNER.CutoverFailure) as caught:
                OWNER.activate(actions)
        self.assertEqual(caught.exception.stage, 'stop_old')
        self.assertIsNone(caught.exception.old_stopped)
        self.assertFalse(caught.exception.enrollment_committed)
        self.assertIsNone(caught.exception.reason)
        self.assertNotIn('enroll', actions.calls)
        self.assertNotIn('restore_legacy', actions.calls)

    def test_deadline_crossing_never_advances_or_restarts_old_worker(self):
        stages = ['preflight', 'prepare', 'readiness', 'rehearse', 'deadline',
                  'stop_old', 'enroll', 'record_commit', 'start', 'verify']
        for index, stage in enumerate(stages):
            with self.subTest(stage=stage):
                actions = Actions()
                times = [1790500000] * index + [OWNER.DEADLINE_EPOCH - 180]
                with patch.object(OWNER.time, 'time', side_effect=times):
                    with self.assertRaises(OWNER.CutoverFailure) as caught:
                        OWNER.activate(actions)
                self.assertEqual(actions.calls, stages[:index])
                self.assertEqual(caught.exception.stage, stage)
                self.assertEqual(caught.exception.old_stopped, index > stages.index('stop_old'))
                self.assertEqual(caught.exception.enrollment_committed, index > stages.index('enroll'))


if __name__ == '__main__':
    unittest.main()
