import copy
import importlib.util
from pathlib import Path
import unittest
import shlex
import subprocess


SOURCE = Path(__file__).with_name('runtime_scheduler.py')
SPEC = importlib.util.spec_from_file_location('runtime_scheduler', SOURCE)
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class SchedulerContractTests(unittest.TestCase):
    def test_snapshot_and_dispatch_have_disjoint_credentials_and_users(self):
        worker = RUNTIME.container_contract('background', 'a' * 64)
        snapshot = RUNTIME.container_contract('snapshot', 'a' * 64)
        self.assertNotEqual(worker['Config']['User'], snapshot['Config']['User'])
        self.assertEqual([mount['Destination'] for mount in snapshot['Mounts']],
                         ['/opt/pvb-worker', '/run/pvb-worker/snapshot.json'])
        self.assertNotIn('snapshot.json', str(worker))
        self.assertNotIn('prefunded-first-card.json', str(snapshot))
        self.assertFalse(snapshot['Mounts'][1]['RW'])
        self.assertFalse(worker['Mounts'][1]['RW'])
        self.assertTrue(worker['Mounts'][2]['RW'])

    def test_containers_are_nonroot_portless_and_hard_bounded(self):
        for kind in ('background', 'snapshot', 'readiness'):
            value = RUNTIME.container_contract(kind, 'a' * 64)
            self.assertNotEqual(value['Config']['User'].split(':')[0], '0')
            self.assertTrue(value['HostConfig']['ReadonlyRootfs'])
            self.assertFalse(value['HostConfig']['Privileged'])
            self.assertEqual(value['HostConfig']['CapDrop'], ['ALL'])
            self.assertEqual(value['HostConfig']['SecurityOpt'], ['no-new-privileges'])
            self.assertEqual(value['HostConfig']['PortBindings'], {})
            self.assertEqual(value['HostConfig']['RestartPolicy']['Name'], 'no')
            self.assertEqual(value['Config']['Cmd'][0], '/usr/bin/timeout')
            self.assertLessEqual(int(value['Config']['Cmd'][2].removesuffix('s')), 470)
            RUNTIME.validate_container(value, kind, 'a' * 64)

    def test_rejects_extra_secret_mount_environment_and_privilege_drift(self):
        value = RUNTIME.container_contract('background', 'a' * 64)
        for section, name, content in [('HostConfig', 'Privileged', True),
                                       ('HostConfig', 'Binds', ['/etc:/etc']),
                                       ('Config', 'User', '0:0')]:
            changed = copy.deepcopy(value)
            changed[section][name] = content
            with self.assertRaises(RUNTIME.Refused):
                RUNTIME.validate_container(changed, 'background', 'a' * 64)
        value['Mounts'].append(dict(Type='bind', Source='/etc', Destination='/secret', RW=False))
        with self.assertRaises(RUNTIME.Refused):
            RUNTIME.validate_container(value, 'background', 'a' * 64)

    def test_units_never_enable_boot_or_schedule_recovery_separately(self):
        units = RUNTIME.units()
        self.assertEqual(len(units), 6)
        self.assertNotIn('[Install]', ''.join(units.values()))
        self.assertNotIn('recovery-runner', ''.join(units.values()))
        self.assertIn('OnCalendar=2026-09-29 15:59:10 UTC', units['deadline.timer'])
        self.assertIn('TimeoutStartSec=480', units['background.service'])
        self.assertIn('TimeoutStartSec=45', units['snapshot.service'])
        self.assertIn('OnUnitInactiveSec=300s', units['snapshot.timer'])
        self.assertIn('ExecStopPost=', units['background.service'])
        self.assertIn('background.timer', units['deadline.service'])
        self.assertIn('snapshot.timer', units['deadline.service'])

    def test_compiled_wrapper_preserves_private_lock_and_has_no_package_manager(self):
        wrapper = RUNTIME.background_wrapper()
        self.assertIn('flock -n 9', wrapper)
        self.assertIn('PREFUNDED_CARD_BACKGROUND_LOCK_HELD=1', wrapper)
        self.assertIn('%u:%a:%h', wrapper)
        self.assertIn('/usr/local/bin/node /opt/pvb-worker/background.cjs', wrapper)
        self.assertIn('[[ "$report" == \'{"status":"completed"}\' ]]', wrapper)
        self.assertNotIn('exit 0', wrapper)
        self.assertNotIn('pnpm', wrapper)
        self.assertNotIn('tsx', wrapper)

    def test_unknown_container_kind_is_rejected(self):
        with self.assertRaises(RUNTIME.Refused):
            RUNTIME.container_contract('unreviewed', 'a' * 64)

    def test_scheduled_wrapper_exits_zero_only_for_completed_pass(self):
        wrapper = RUNTIME.background_wrapper()
        tail = wrapper[wrapper.index('report='):]
        for report, expected in [('{"status":"completed"}', 0), ('{"status":"busy"}', 1),
                                 ('{"status":"failed"}', 1), ('not json', 1)]:
            command = tail.replace('/usr/local/bin/node /opt/pvb-worker/background.cjs',
                                   "printf '%s' " + shlex.quote(report))
            result = subprocess.run(['/bin/bash', '-c', command], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, expected)
            self.assertEqual(result.stdout, ('{"status":"completed"}\n' if expected == 0 else '{"status":"failed"}\n'))


if __name__ == '__main__':
    unittest.main()
