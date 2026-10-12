import unittest
from unittest.mock import Mock

from connectivity_transaction import execute
from renewal_contract import Refused


class ConnectivityTransactionTests(unittest.TestCase):
    def test_expired_funding_stops_before_role_or_files_change_and_timers_precede_start(self):
        actions = Mock()
        actions.finish.return_value = {'status': 'connectivity-renewed'}
        result = execute(actions)
        names = [call[0] for call in actions.mock_calls]
        self.assertEqual(names, ['preflight', 'stop', 'rehearse_role', 'bind_role', 'install',
                                 'arm_deadlines', 'fresh_evidence', 'start', 'verify', 'finish'])
        self.assertEqual(result['status'], 'connectivity-renewed')

    def test_each_failure_after_stop_leaves_all_runtimes_stopped_and_restores_only_owned_writes(self):
        for step in ('stop', 'rehearse_role', 'bind_role', 'install', 'arm_deadlines',
                     'fresh_evidence', 'start', 'verify', 'finish'):
            actions = Mock()
            getattr(actions, step).side_effect = Refused('fixture')
            with self.subTest(step=step), self.assertRaises(Refused):
                execute(actions)
            self.assertEqual(actions.mock_calls[-1][0], 'recover')
            self.assertNotIn('finish', [call[0] for call in actions.mock_calls[:-1]] if step != 'finish' else [])

    def test_preflight_refusal_never_mutates_or_recovers(self):
        actions = Mock()
        actions.preflight.side_effect = Refused('drift')
        with self.assertRaises(Refused):
            execute(actions)
        actions.stop.assert_not_called()
        actions.recover.assert_not_called()

    def test_ambiguous_recovery_is_not_misreported_as_no_change(self):
        actions = Mock()
        actions.install.side_effect = RuntimeError('secret')
        actions.recover.side_effect = Refused('recovery-unconfirmed')
        with self.assertRaisesRegex(Refused, '^recovery-unconfirmed$'):
            execute(actions)


if __name__ == '__main__':
    unittest.main()
