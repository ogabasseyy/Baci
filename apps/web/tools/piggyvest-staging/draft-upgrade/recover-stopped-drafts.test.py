import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY))
specification = importlib.util.spec_from_file_location('recovery', DIRECTORY / 'recover-stopped-drafts.py')
recovery = importlib.util.module_from_spec(specification)
specification.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def test_recovers_only_exact_stopped_invocation(self):
        expected = 'a' * 32
        values = {'ActiveState': 'failed', 'MainPID': '0', 'ControlPID': '0',
                  'Result': 'exit-code', 'ExecMainStatus': '143', 'InvocationID': expected}
        with patch.object(recovery.os, 'geteuid', return_value=0), \
                patch.object(recovery, 'assert_unit'), patch.object(recovery, 'assert_timer'), \
                patch.object(recovery, 'show', side_effect=lambda unit, key: values[key]), \
                patch.object(recovery, 'command') as command:
            recovery.recover(expected)
        command.assert_called_once_with(['/usr/bin/systemctl', 'start', recovery.SERVICE])

    def test_refuses_changed_live_or_unrelated_failure(self):
        expected = 'a' * 32
        base = {'ActiveState': 'failed', 'MainPID': '0', 'ControlPID': '0',
                'Result': 'exit-code', 'ExecMainStatus': '143', 'InvocationID': expected}
        for key, value in [('InvocationID', 'b' * 32), ('MainPID', '42'),
                           ('ControlPID', '43'), ('ExecMainStatus', '1'),
                           ('ActiveState', 'active')]:
            values = dict(base, **{key: value})
            with self.subTest(key=key), patch.object(recovery.os, 'geteuid', return_value=0), \
                    patch.object(recovery, 'assert_unit'), patch.object(recovery, 'assert_timer'), \
                    patch.object(recovery, 'show', side_effect=lambda unit, name: values[name]), \
                    patch.object(recovery, 'command') as command, \
                    self.assertRaises(recovery.Refused):
                recovery.recover(expected)
            command.assert_not_called()

    def test_refuses_non_root_or_invalid_invocation(self):
        with patch.object(recovery.os, 'geteuid', return_value=501), self.assertRaises(recovery.Refused):
            recovery.recover('a' * 32)


if __name__ == '__main__':
    unittest.main()
