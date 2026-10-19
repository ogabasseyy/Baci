import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('engagement_owner', Path(__file__).with_name('owner.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OwnerTests(unittest.TestCase):
    def test_resume_verifies_current_artifact_and_never_replaces_or_restarts_backend(self):
        artifact = Mock()
        nginx = Mock()
        nginx.ActivationFailure = ValueError
        nginx.install.side_effect = [{'status': 'checked'}, RuntimeError('probe stopped')]
        with patch.object(MODULE, 'HERE', Path('/root/baci-savings-engagement.test')), patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE, 'load_module', side_effect=[artifact, nginx]), patch.object(MODULE, 'read_root', side_effect=[(b'{"workerSha256":"abc"}', None), (b'nginx', None)]), patch.object(MODULE, 'command', return_value='{"status":"already_applied"}') as command:
            with self.assertRaisesRegex(RuntimeError, 'probe stopped'):
                MODULE.install(resume=True)
        artifact.verify_installed.assert_called_once()
        artifact.prepare.assert_not_called()
        artifact.activate.assert_not_called()
        artifact.run_service.assert_not_called()
        self.assertFalse(any('--apply' in call.args for call in command.call_args_list))

    def test_resume_refuses_unverified_gateway_state_before_installing_anything(self):
        artifact, nginx = Mock(), Mock()
        nginx.ActivationFailure = ValueError
        with patch.object(MODULE, 'HERE', Path('/root/baci-savings-engagement.test')), patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE, 'load_module', side_effect=[artifact, nginx]), patch.object(MODULE, 'read_root', return_value=(b'{"workerSha256":"abc"}', None)), patch.object(MODULE, 'command', return_value='{"status":"ready"}') as command:
            with self.assertRaisesRegex(RuntimeError, 'already applied'):
                MODULE.install(resume=True)
        self.assertEqual(command.call_count, 1)
        nginx.install.assert_not_called()
        artifact.activate.assert_not_called()

    def test_capability_addition_preserves_existing_environment_bytes(self):
        original = b'EXISTING_SETTING=value\nANOTHER_SETTING=unchanged\n'
        actual = MODULE.enable_capability(original)
        self.assertEqual(actual, original + b'SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=true\n')
        self.assertEqual(MODULE.enable_capability(actual), actual)

    def test_updates_only_its_existing_false_capability(self):
        original = b'OTHER=value\nSAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=false\nLAST=value\n'
        self.assertEqual(MODULE.enable_capability(original), original.replace(b'=false', b'=true'))

    def test_refuses_duplicate_or_unexpected_capability(self):
        for original in (
            b'SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=bad\n',
            b'SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=false\nSAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=true\n',
        ):
            with self.assertRaises(RuntimeError):
                MODULE.enable_capability(original)

    def test_failed_service_health_restores_capability_before_retry(self):
        previous = b'OTHER=value\n'
        desired = MODULE.enable_capability(previous)
        metadata = SimpleNamespace(st_mode=0o100600)
        with tempfile.TemporaryDirectory() as directory:
            artifact = SimpleNamespace(run_service=lambda action: None)
            with patch.object(MODULE, 'HERE', Path(directory)), patch.object(MODULE, 'read_root', side_effect=[(previous, metadata), (previous, metadata), (desired, metadata)]), patch.object(MODULE, 'replace_environment') as replace:
                with patch.object(artifact, 'probe_health', side_effect=[RuntimeError('bad health'), None], create=True):
                    with self.assertRaisesRegex(RuntimeError, 'rolled back'):
                        MODULE.activate_capability(artifact)
            self.assertEqual([call.args[0] for call in replace.call_args_list], [desired, previous])
            self.assertEqual((Path(directory) / 'funding-service.environment.backup').read_bytes(), previous)

    def test_adds_separator_without_merging_with_previous_variable(self):
        self.assertEqual(MODULE.enable_capability(b'OTHER=value'), b'OTHER=value\nSAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=true\n')

    def test_failed_activation_disables_both_timers_so_reboot_cannot_resume_delivery(self):
        with patch.object(MODULE, 'command') as command:
            self.assertTrue(MODULE.withdraw_delivery())
        self.assertEqual(command.call_args_list[0].args, ('/usr/bin/systemctl', 'disable', '--now', *MODULE.TIMERS))
        self.assertEqual(command.call_args_list[1].args, ('/usr/bin/systemctl', 'stop', MODULE.WORKER, MODULE.WORKER_CHECK))

    def test_timer_disable_failure_still_attempts_to_stop_the_worker(self):
        with patch.object(MODULE, 'command', side_effect=[RuntimeError('disable failure'), '']) as command:
            self.assertFalse(MODULE.withdraw_delivery())
        self.assertEqual(command.call_args_list[1].args, ('/usr/bin/systemctl', 'stop', MODULE.WORKER, MODULE.WORKER_CHECK))


if __name__ == '__main__':
    unittest.main()
