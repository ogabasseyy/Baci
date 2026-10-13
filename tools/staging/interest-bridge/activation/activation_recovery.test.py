import unittest
from unittest.mock import Mock, patch
from activation_recovery import recover, REVOKE


class RecoveryTests(unittest.TestCase):
    def test_refusal_before_private_install_does_not_touch_any_live_authority(self):
        command, docker, database = Mock(), Mock(), Mock()
        result = recover({}, command, docker, database)
        command.assert_not_called()
        docker.assert_not_called()
        database.assert_not_called()
        self.assertTrue(result['newRuntimeStopped'])

    def test_revoke_preserves_paid_receipts_without_blocking_revocation(self):
        self.assertIn('REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt', REVOKE)
        self.assertNotIn('ALTER ROLE', REVOKE)
        self.assertNotIn('DELETE', REVOKE)
        self.assertNotIn('interest_receipts', REVOKE)

    def test_revoke_is_attempted_even_when_unit_and_container_stop_fail(self):
        database = Mock()
        with patch('activation_recovery.Path.exists', return_value=True), patch(
                'activation_recovery.Path.read_bytes', side_effect=OSError('drift')):
            result = recover(dict(targetCreated=True, grantAttempted=True), Mock(),
                             Mock(side_effect=OSError('docker unavailable')), database)
        database.assert_called_once_with(REVOKE)
        self.assertTrue(result['bridgeGrantRolledBack'])
        self.assertFalse(result['newRuntimeStopped'])

    def test_recovery_keeps_deadline_timer_as_backstop(self):
        command = Mock(return_value=Mock(stdout='inactive'))
        docker = Mock(side_effect=[Mock(returncode=1), Mock(stdout=''),
                                   Mock(returncode=1), Mock(stdout='')])
        with patch('activation_recovery.Path.exists', return_value=True), patch(
                'activation_recovery.Path.read_bytes', return_value=__import__('activation_contract').unit_files()[
                    __import__('activation_contract').SERVICE]):
            recover(dict(targetCreated=True), command, docker, Mock())
        self.assertFalse(any('baci-interest-replay-deadline.timer' in str(call)
                             for call in command.call_args_list))

    def test_revoke_failure_is_explicitly_reported(self):
        result = recover(dict(grantAttempted=True), Mock(), Mock(),
                         Mock(side_effect=ValueError('database unavailable')))
        self.assertFalse(result['bridgeGrantRolledBack'])
        self.assertIn('grant-revoke-unconfirmed', result['failures'])


if __name__ == '__main__':
    unittest.main()
