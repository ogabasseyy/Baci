import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY.parent))
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location('readonly_owner', DIRECTORY / 'owner.py')
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class OwnerTests(unittest.TestCase):
    def test_refuses_running_or_self_restarting_financial_container(self):
        for running, restart in ((True, 'no'), (False, 'always'), (False, 'unless-stopped')):
            with patch.object(owner, 'inspect', return_value={'State': {'Running': running},
                    'HostConfig': {'RestartPolicy': {'Name': restart}}}), self.assertRaises(owner.Refused):
                owner.financial_off()

    def test_off_proof_checks_every_container_and_financial_service(self):
        with patch.object(owner, 'inspect', return_value={'State': {'Running': False},
                'HostConfig': {'RestartPolicy': {'Name': 'no'}}}) as inspect, \
             patch.object(owner, 'properties', return_value={'ActiveState': 'inactive'}) as properties:
            owner.financial_off()
        self.assertEqual(inspect.call_count, 3)
        self.assertEqual(properties.call_count, 3)

    def test_refuses_effective_unit_dropins_reload_or_wrong_fragment(self):
        for output in ('DropInPaths=/override\nNeedDaemonReload=no\nFragmentPath=/etc/systemd/system/test.service',
                       'DropInPaths=\nNeedDaemonReload=yes\nFragmentPath=/etc/systemd/system/test.service',
                       'DropInPaths=\nNeedDaemonReload=no\nFragmentPath=/foreign/test.service'):
            with patch.object(owner, 'command', return_value=output), self.assertRaises(owner.Refused):
                owner.properties('test.service')

    def test_expired_or_nonroot_invocation_performs_no_write_or_command(self):
        for uid, now in ((1001, owner.DEADLINE_EPOCH - 1), (0, owner.DEADLINE_EPOCH)):
            with patch.object(owner.os, 'getuid', return_value=uid), \
                 patch.object(owner.time, 'time', return_value=now), \
                 patch.object(owner, 'command') as command, \
                 patch.object(owner, 'write_private') as write, self.assertRaises(owner.Refused):
                owner.activate(Path('/root/fixture'))
            command.assert_not_called()
            write.assert_not_called()

    def test_readonly_launcher_pin_is_checked_before_live_installation(self):
        with patch.object(owner.os, 'getuid', return_value=0), \
             patch.object(owner.time, 'time', return_value=owner.DEADLINE_EPOCH - 1), \
             patch.object(owner, 'read', return_value=b'fixture'), \
             patch.object(owner, 'validate_archive', return_value={'launch-public.cjs': b'unreviewed'}), \
             patch.object(owner, 'prepare_tree') as prepare, self.assertRaises(owner.Refused):
            owner.activate(Path('/root/fixture'))
        prepare.assert_not_called()


if __name__ == '__main__':
    unittest.main()
