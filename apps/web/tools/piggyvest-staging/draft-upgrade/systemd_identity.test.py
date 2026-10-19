import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY))


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, DIRECTORY / filename)
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


artifact = load('artifact_validation', 'artifact_validation.py')
descriptor_copy = load('descriptor_copy', 'descriptor_copy.py')
identity = load('systemd_identity', 'systemd_identity.py')
upgrade = load('upgrade', 'upgrade-savings-drafts.py')


class SystemdIdentityTests(unittest.TestCase):
    def exec_start(self, argv='/usr/bin/node server.js', code='(null)', status='0/0'):
        return ('{ path=/usr/bin/node ; argv[]=%s ; ignore_errors=no ; '
                'start_time=[Tue 2026-09-22 15:59:17 UTC] ; stop_time=[n/a] ; '
                'pid=2446927 ; code=%s ; status=%s }') % (argv, code, status)

    def show_values(self, overrides=None):
        values = {'FragmentPath': '/etc/systemd/system/baci-savings-drafts-smoke.service',
                  'User': 'baci-savings-gateway', 'WorkingDirectory': '/opt/baci-savings-drafts/apps/web',
                  'DropInPaths': '', 'NeedDaemonReload': 'no', 'EnvironmentFiles': '',
                  'Environment': 'NODE_ENV=production PORT=4794', 'NoNewPrivileges': 'yes',
                  'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes',
                  'PrivateDevices': 'yes', 'CapabilityBoundingSet': '', 'ExecStart': self.exec_start(),
                  'ExecStartPre': '', 'ExecStartPost': '', 'ExecReload': '', 'ExecStop': '', 'ExecStopPost': ''}
        return {**values, **(overrides or {})}

    def test_regression_execstart_must_be_exact_and_all_extra_hooks_refuse(self):
        with patch.object(identity, 'show', side_effect=lambda _unit, key: self.show_values({'ExecStart': self.exec_start('/usr/bin/node server.js --bad')}).get(key, '')):
            with self.assertRaisesRegex(artifact.Refused, 'ExecStart identity'):
                identity.assert_exec(identity.SERVICE)
        with patch.object(identity, 'show', side_effect=lambda _unit, key: self.show_values({'ExecStartPre': '{ path=/bin/true }'}).get(key, '')):
            with self.assertRaisesRegex(artifact.Refused, 'ExecStartPre'):
                identity.assert_exec(identity.SERVICE)
        with patch.object(identity, 'show', side_effect=lambda _unit, key: self.show_values({'ExecStart': self.exec_start(code='exited', status='143')}).get(key, '')):
            identity.assert_exec(identity.SMOKE)

    def test_regression_dropins_daemon_reload_and_wrong_smoke_port_refuse(self):
        with patch.object(identity, 'show', side_effect=lambda _unit, key: self.show_values({'DropInPaths': '/etc/systemd/system/x.conf'}).get(key, '')):
            with self.assertRaisesRegex(artifact.Refused, 'DropInPaths'):
                identity.assert_unit(identity.SMOKE, '/etc/systemd/system/baci-savings-drafts-smoke.service', True)
        with patch.object(identity, 'show', side_effect=lambda _unit, key: self.show_values({'Environment': 'PORT=4795'}).get(key, '')):
            with self.assertRaisesRegex(artifact.Refused, 'environment'):
                identity.assert_unit(identity.SMOKE, '/etc/systemd/system/baci-savings-drafts-smoke.service', True)

    def test_regression_timer_uses_supported_next_elapse_property(self):
        values = {'ActiveState': 'active', 'FragmentPath': '/etc/systemd/system/baci-savings-drafts-deadline.timer',
                  'DropInPaths': '', 'NeedDaemonReload': 'no', 'NextElapseUSecRealtime': 'Tue 2026-09-29 15:59:10 UTC'}
        with patch.object(identity.time, 'time', return_value=1), \
                patch.object(identity, 'show', side_effect=lambda _unit, key: values[key]):
            identity.assert_timer()
        values['NextElapseUSecRealtime'] = 'Tue 2026-09-29 16:00:00 UTC'
        with patch.object(identity.time, 'time', return_value=1), \
                patch.object(identity, 'show', side_effect=lambda _unit, key: values[key]):
            with self.assertRaisesRegex(artifact.Refused, 'deadline identity'):
                identity.assert_timer()

    def test_regression_owned_stop_accepts_next_exit_143_without_live_process(self):
        original = identity.Invocation(identity.SERVICE, 'a' * 32, 42)
        values = {'ActiveState': 'failed', 'MainPID': '0', 'ControlPID': '0',
                  'InvocationID': original.identifier, 'Result': 'exit-code',
                  'ExecMainStatus': '143'}
        with patch.object(identity, 'capture_live', return_value=original), \
                patch.object(identity, 'command'), \
                patch.object(identity, 'show', side_effect=lambda unit, key: values[key]):
            identity.stop_owned(original, '/etc/systemd/system/baci-savings-drafts.service', False)

    def test_regression_stop_rejects_live_or_changed_failed_invocation(self):
        original = identity.Invocation(identity.SERVICE, 'a' * 32, 42)
        base = {'ActiveState': 'failed', 'MainPID': '0', 'ControlPID': '0',
                'InvocationID': original.identifier, 'Result': 'exit-code',
                'ExecMainStatus': '143'}
        for field, value in [('MainPID', '42'), ('ControlPID', '43'),
                             ('InvocationID', 'b' * 32), ('ExecMainStatus', '1')]:
            values = dict(base, **{field: value})
            with self.subTest(field=field), \
                    patch.object(identity, 'capture_live', return_value=original), \
                    patch.object(identity, 'command'), \
                    patch.object(identity, 'show', side_effect=lambda unit, key: values[key]), \
                    self.assertRaises(artifact.Refused):
                identity.stop_owned(original, '/etc/systemd/system/baci-savings-drafts.service', False)

    def test_regression_changed_invocation_is_never_stopped(self):
        original = identity.Invocation(identity.SERVICE, 'a' * 32, 42)
        replacement = identity.Invocation(identity.SERVICE, 'b' * 32, 43)
        with patch.object(identity, 'capture_live', return_value=replacement), patch.object(identity, 'command') as command:
            with self.assertRaisesRegex(artifact.Refused, 'invocation changed'):
                identity.stop_owned(original, '/etc/systemd/system/baci-savings-drafts.service', False)
        command.assert_not_called()

    def test_regression_health_wait_retries_after_startup_without_accepting_wrong_invocation(self):
        invocation = identity.Invocation(identity.SERVICE, 'a' * 32, 42)
        with patch.object(upgrade, 'capture_live', return_value=invocation), \
                patch.object(upgrade, 'probe', side_effect=[False, False, True]), \
                patch.object(upgrade.time, 'sleep') as sleep:
            upgrade.wait_for_401(invocation, '/etc/systemd/system/baci-savings-drafts.service', 4792, False)
        self.assertEqual(sleep.call_count, 2)



if __name__ == '__main__':
    unittest.main()

