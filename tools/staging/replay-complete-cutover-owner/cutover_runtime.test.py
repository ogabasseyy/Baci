import unittest
from unittest.mock import patch

import cutover_runtime as runtime


class Operator:
    def __init__(self):
        self.names = {runtime.CONTAINER: runtime.NATIVE_ID}
        self.running = {runtime.NATIVE_ID: True}
        self.actions = []
        self.fail_start = False
        self.precreate_failure = False
        self.expired = False

    def deadline(self):
        if self.expired:
            raise ValueError('expired')

    def find(self, name):
        return self.names.get(name)

    def inspect(self, identifier, directory, label, check=False, name=None):
        if self.names.get(name) != identifier:
            raise ValueError('identity changed')
        return {'Id': identifier, 'State': {'Running': self.running[identifier],
                                            'ExitCode': 0, 'OOMKilled': False}}

    def run(self, arguments, timeout=30):
        self.actions.append(arguments)
        action = arguments[2]
        if action == 'stop':
            self.running[arguments[-1]] = False
        elif action == 'rename':
            identifier, name = arguments[-2:]
            old = next(key for key, value in self.names.items() if value == identifier)
            del self.names[old]
            self.names[name] = identifier
        return ''

    def create(self, directory, label, check=False, name=None):
        self.actions.append(['create', name])
        self.names[name] = 'a' * 64
        self.running['a' * 64] = False
        if self.precreate_failure:
            raise ValueError('creation observation failed')
        return 'a' * 64

    def start_bounded(self, identifier, directory, label, check=False, name=None):
        self.actions.append(['start', identifier])
        self.running[identifier] = True
        if self.fail_start:
            raise ValueError('runtime failed after start')


class StopOnlyCutoverTests(unittest.TestCase):
    def setUp(self):
        self.operator = Operator()
        self.exclusive = True
        self.prestart = True
        self.competitor_running = False
        self.records = []
        self.controller = runtime.CutoverRuntime(
            self.operator, lambda: True,
            lambda: {'Id': runtime.COMPETITOR_ID, 'Name': '/baci-interest-replay',
                     'State': {'Running': self.competitor_running}},
            lambda: self.exclusive, lambda: self.prestart,
            lambda name, report: self.records.append((name, report)))

    def test_quiesces_exact_native_without_changing_deadline_or_receipt_state(self):
        report = self.controller.quiesce()
        self.assertEqual(report['stoppedClaimantIds'], sorted([
            runtime.NATIVE_ID, runtime.COMPETITOR_ID]))
        self.assertFalse(self.operator.running[runtime.NATIVE_ID])
        self.assertEqual(len(self.operator.actions), 1)
        self.assertEqual(self.operator.actions[0][-1], runtime.NATIVE_ID)

    def test_starts_only_candidate_and_retains_stopped_predecessor(self):
        self.controller.quiesce()
        report = self.controller.start()
        self.assertEqual(report['status'], 'sealed-paired-replay-running')
        self.assertFalse(self.operator.running[runtime.NATIVE_ID])
        self.assertTrue(self.operator.running['a' * 64])
        self.assertEqual(self.operator.names[runtime.RETAINED], runtime.NATIVE_ID)

    def test_started_candidate_failure_stops_it_without_restoring_old_generation(self):
        self.controller.quiesce()
        self.operator.fail_start = True
        with self.assertRaisesRegex(ValueError, 'no_predecessor_restart'):
            self.controller.start()
        self.assertFalse(self.operator.running[runtime.NATIVE_ID])
        self.assertFalse(self.operator.running['a' * 64])
        self.assertNotIn(['start', runtime.NATIVE_ID], self.operator.actions)

    def test_cleanup_failure_is_sanitized_and_reports_candidate_stop_unconfirmed(self):
        self.controller.quiesce()
        self.operator.fail_start = True
        with patch.object(self.controller, '_stop_candidate', side_effect=RuntimeError('PRIVATE_DETAILS')):
            with self.assertRaisesRegex(ValueError, '^cutover_start_refused_candidate_stop_unconfirmed$') as caught:
                self.controller.start()
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertFalse(self.operator.running[runtime.NATIVE_ID])
        self.assertNotIn(['start', runtime.NATIVE_ID], self.operator.actions)

    def test_ambiguous_create_observation_stops_verified_candidate_only(self):
        self.controller.quiesce()
        self.operator.precreate_failure = True
        with self.assertRaisesRegex(ValueError, 'no_predecessor_restart'):
            self.controller.start()
        self.assertFalse(self.operator.running[runtime.NATIVE_ID])
        self.assertFalse(self.operator.running['a' * 64])
        self.assertEqual(self.operator.names[runtime.RETAINED], runtime.NATIVE_ID)

    def test_refuses_missing_fence_prestart_before_any_container_rename(self):
        self.controller.quiesce()
        self.operator.actions.clear()
        self.prestart = False
        with self.assertRaisesRegex(ValueError, 'no_predecessor_restart'):
            self.controller.start()
        self.assertEqual(self.operator.actions, [])

    def test_refuses_competitor_restart_before_launch(self):
        self.controller.quiesce()
        self.operator.actions.clear()
        self.competitor_running = True
        with self.assertRaisesRegex(ValueError, 'no_predecessor_restart'):
            self.controller.start()
        self.assertEqual(self.operator.actions, [])

    def test_refuses_expired_deadline_without_restarting_predecessor(self):
        self.controller.quiesce()
        self.operator.expired = True
        with self.assertRaisesRegex(ValueError, 'no_predecessor_restart'):
            self.controller.start()
        self.assertFalse(self.operator.running[runtime.NATIVE_ID])

    def test_refuses_launch_without_exclusive_owner_control(self):
        self.exclusive = False
        with self.assertRaisesRegex(ValueError, 'exclusive_launch_control'):
            self.controller.quiesce()
        self.assertEqual(self.operator.actions, [])


if __name__ == '__main__':
    unittest.main()
