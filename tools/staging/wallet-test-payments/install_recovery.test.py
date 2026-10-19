import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch


SPEC = importlib.util.spec_from_file_location('wallet_test_install_recovery', Path(__file__).with_name('install_recovery.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RecoveryTests(unittest.TestCase):
    def test_missing_service_is_stopped_but_unknown_or_active_state_is_not(self):
        self.assertTrue(MODULE.service_stopped(1, 'LoadState=not-found\nActiveState=inactive\n'))
        self.assertTrue(MODULE.service_stopped(0, 'LoadState=loaded\nActiveState=inactive\n'))
        self.assertFalse(MODULE.service_stopped(0, 'LoadState=loaded\nActiveState=active\n'))
        self.assertFalse(MODULE.service_stopped(1, ''))

    def test_preserves_every_file_if_database_provisioning_has_started(self):
        state, root, stop, topups = MagicMock(), MagicMock(), MagicMock(), MagicMock()
        state.exists.return_value = True
        receipt = MODULE._receipt('a' * 64, b'server', 'b' * 64, 'database-started')
        with patch.object(MODULE, '_read_phase', return_value=receipt):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.recover_pre_activation(state, 'a' * 64, b'server', 'b' * 64, root, {}, topups, stop)
        stop.assert_not_called()
        topups.assert_not_called()
        root.rmdir.assert_not_called()

    def test_records_database_phase_before_provisioning_can_start(self):
        state = Path('/root/receipt')
        with patch.object(MODULE, '_write_phase') as write:
            MODULE.mark_database_started(state, 'a' * 64, b'server', 'b' * 64)
        write.assert_called_once_with(state, 'a' * 64, b'server', 'b' * 64, 'database-started')

    def test_retries_only_a_matching_pre_activation_receipt_with_no_topups(self):
        state, root, stop = MagicMock(), MagicMock(), MagicMock()
        state.exists.return_value = True; state.is_symlink.return_value = False; state.iterdir.return_value = []
        root.exists.return_value = False; root.is_symlink.return_value = False
        receipt = MODULE._receipt('a' * 64, b'server', 'b' * 64, 'pre-activation')
        unit = Path('/etc/systemd/system/baci-staging-test-payments.service')
        with patch.object(MODULE, '_read_phase', return_value=receipt), patch.object(MODULE, '_unlink_exact') as unlink:
            self.assertTrue(MODULE.recover_pre_activation(state, 'a' * 64, b'server', 'b' * 64, root, {unit: b'unit'}, lambda: False, stop))
        stop.assert_called_once_with()
        unlink.assert_called_once_with(unit, b'unit')
        state.rmdir.assert_called_once_with()

    def test_partial_gateway_applied_attempt_remains_blocked_for_owner_recovery(self):
        state, root, stop, topups = MagicMock(), MagicMock(), MagicMock(), MagicMock()
        state.exists.return_value = True; state.is_symlink.return_value = False
        receipt = MODULE._receipt('a' * 64, b'server', 'b' * 64, 'gateway-applied')
        with patch.object(MODULE, '_read_phase', return_value=receipt):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.recover_pre_activation(state, 'a' * 64, b'server', 'b' * 64, root, {}, topups, stop)
        topups.assert_not_called()
        stop.assert_not_called()

    def test_refuses_pre_activation_cleanup_when_any_topup_exists(self):
        state, root, stop = MagicMock(), MagicMock(), MagicMock()
        state.exists.return_value = True; state.is_symlink.return_value = False
        state.iterdir.return_value = []
        root.exists.return_value = False; root.is_symlink.return_value = False
        receipt = MODULE._receipt('a' * 64, b'server', 'b' * 64, 'pre-activation')
        with patch.object(MODULE, '_read_phase', return_value=receipt), patch.object(MODULE, '_unlink_exact') as unlink:
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.recover_pre_activation(state, 'a' * 64, b'server', 'b' * 64, root, {}, lambda: True, stop)
        stop.assert_not_called()
        unlink.assert_not_called()


if __name__ == '__main__':
    unittest.main()
