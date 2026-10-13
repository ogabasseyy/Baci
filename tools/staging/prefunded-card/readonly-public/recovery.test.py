import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY.parent))
spec = importlib.util.spec_from_file_location('readonly_recovery', DIRECTORY / 'recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def test_secondary_failures_do_not_prevent_unit_restore_or_reload(self):
        command, replace, create = Mock(), Mock(), Mock()
        inspect = Mock(side_effect=RuntimeError('unavailable'))
        with patch.object(recovery.subprocess, 'run', side_effect=TimeoutError()):
            errors = recovery.recover(Path('/retained'), Path('/root/audit'), False, True,
                {'test.service': b'old'}, inspect, command, replace, create, 'm' * 64, 'p' * 64)
        self.assertEqual(errors, ['stop-public-units', 'remove-owned-candidate-container'])
        replace.assert_called_once_with(Path('/etc/systemd/system/test.service'), b'old')
        command.assert_called_once_with(['/usr/bin/systemctl', 'daemon-reload'])
        create.assert_called_once_with('p' * 64)

    def test_refuses_to_force_remove_a_replaced_or_foreign_container(self):
        command = Mock()
        observed = {'Name': '/baci-prefunded-public', 'Image': recovery.service.IMAGE,
            'Config': {'Labels': {recovery.service.LABEL: 'foreign'}}, 'Id': 'a' * 64}
        with patch.object(recovery.subprocess, 'run', return_value=Mock(returncode=0)):
            errors = recovery.recover(Path('/retained'), Path('/root/audit'), False, True,
                {}, Mock(return_value=observed), command, Mock(), Mock(), 'm' * 64, 'p' * 64)
        self.assertIn('remove-owned-candidate-container', errors)
        self.assertEqual(command.call_args_list[0].args[0], ['/usr/bin/systemctl', 'daemon-reload'])

    def test_removes_only_owned_candidate_id_and_never_restarts_expired_predecessor(self):
        command, create = Mock(), Mock()
        observed = {'Name': '/baci-prefunded-public', 'Image': recovery.service.IMAGE,
            'Config': {'Labels': {recovery.service.LABEL: 'm' * 64}}, 'Id': 'a' * 64}
        with patch.object(recovery.subprocess, 'run', return_value=Mock(returncode=0)):
            errors = recovery.recover(Path('/retained'), Path('/root/audit'), False, True,
                {}, Mock(return_value=observed), command, Mock(), create, 'm' * 64, 'p' * 64)
        self.assertEqual(errors, [])
        self.assertEqual(command.call_args_list[0].args[0],
            [*recovery.service.DOCKER, 'rm', '--force', 'a' * 64])
        self.assertEqual(command.call_args_list[1].args[0], ['/usr/bin/systemctl', 'daemon-reload'])
        create.assert_called_once_with('p' * 64)


if __name__ == '__main__':
    unittest.main()
