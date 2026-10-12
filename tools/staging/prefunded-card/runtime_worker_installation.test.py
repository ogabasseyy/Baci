import hashlib
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('workers', Path(__file__).with_name('runtime_worker_installation.py'))
WORKERS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKERS)


class WorkerInstallationTests(unittest.TestCase):
    def test_prepared_secret_pins_are_independent_and_exact(self):
        background = b'{"secret":"worker"}'
        snapshot = b'{"secret":"snapshot"}'
        with patch.object(WORKERS, 'ACTIVATION_SHA', hashlib.sha256(background).hexdigest()), \
                patch.object(WORKERS, 'SNAPSHOT_SHA', hashlib.sha256(snapshot).hexdigest()):
            self.assertEqual(WORKERS.checked_configs(background, snapshot), (background, snapshot))
            with self.assertRaises(WORKERS.Refused):
                WORKERS.checked_configs(snapshot, background)
            with self.assertRaises(WORKERS.Refused):
                WORKERS.checked_configs(background + b' ', snapshot)

    def test_readiness_and_worker_reports_are_not_interchangeable(self):
        WORKERS.validate_report('snapshot', '{"outcome":"recorded"}')
        WORKERS.validate_report('background', '{"status":"completed"}')
        WORKERS.validate_report('readiness', json.dumps(dict(status='restricted-tls-ready',
                               profiles=['worker', 'authorizer', 'evidence'], readOnly=True, cardPaymentsEnabled=False)))
        for output in ('{"status":"completed","secret":"sensitive"}', '{"status":"busy"}',
                       '{"status":"failed"}', '{"outcome":"recorded"}', 'not json'):
            with self.assertRaises(WORKERS.Refused):
                WORKERS.validate_report('background', output)

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'config'
            target.write_bytes(b'old')
            target.chmod(0o600)
            with patch.object(WORKERS.os, 'geteuid', return_value=target.stat().st_uid):
                with self.assertRaises(WORKERS.Refused):
                    WORKERS.place(target, b'new', target.stat().st_uid, 0o600)
            self.assertEqual(target.read_bytes(), b'old')

    def test_unit_dropins_and_wrong_fragments_are_refused(self):
        valid = 'FragmentPath=/etc/systemd/system/baci-prefunded-background.service\nDropInPaths=\n'
        WORKERS.validate_unit(valid, 'background.service')
        for changed in (valid.replace('DropInPaths=\n', 'DropInPaths=/run/override.conf\n'),
                        valid.replace('/etc/systemd/system', '/run/systemd/transient'), ''):
            with self.assertRaises(WORKERS.Refused):
                WORKERS.validate_unit(changed, 'background.service')

    def test_stale_future_missing_and_forged_replay_heartbeats_are_refused(self):
        now = 1790532000
        WORKERS.validate_heartbeat(str((now - 30) * 1000), now)
        for value in ('', 'garbage', str((now - 121) * 1000), str((now + 1) * 1000)):
            with self.assertRaises(WORKERS.Refused):
                WORKERS.validate_heartbeat(value, now)

    def test_failed_installer_cleanup_stops_only_its_own_schedules(self):
        installer = object.__new__(WORKERS.WorkerInstaller)
        installer.timers_started = True
        with patch.object(WORKERS, 'command', return_value='') as command:
            installer.withdraw()
        calls = [entry.args[0] for entry in command.call_args_list]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:2], ['/usr/bin/systemctl', 'stop'])
        self.assertEqual(set(calls[0][2:]), {'baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
                                          'baci-prefunded-background.service', 'baci-prefunded-snapshot.service'})
        installer.timers_started = False
        with patch.object(WORKERS, 'command') as command:
            installer.withdraw()
        command.assert_not_called()

    def test_initial_dispatch_is_proved_under_the_exact_scheduled_unit(self):
        installer = object.__new__(WORKERS.WorkerInstaller)
        stamp = datetime.now(timezone.utc).isoformat()
        clock = unittest.mock.MagicMock()
        clock.now.return_value = datetime.fromisoformat(stamp)
        clock.fromisoformat = datetime.fromisoformat
        state = {'State': {'StartedAt': stamp, 'Running': False, 'ExitCode': 0}}
        outputs = ['', 'Result=success\nExecMainStatus=0\nActiveState=inactive\n', '{"status":"completed"}', '']
        with patch.object(installer, 'container'), patch.object(WORKERS, 'datetime', clock), \
                patch.object(WORKERS, 'inspect', return_value=state), \
                patch.object(WORKERS, 'command', side_effect=outputs) as command:
            installer.run_once('background')
        self.assertEqual(command.call_args_list[0].args[0],
                         ['/usr/bin/systemctl', 'start', 'baci-prefunded-background.service'])
        self.assertIn('--since', command.call_args_list[2].args[0])

    def test_noncompleted_scheduled_unit_report_is_refused_and_container_stopped(self):
        installer = object.__new__(WORKERS.WorkerInstaller)
        stamp = datetime.now(timezone.utc).isoformat()
        clock = unittest.mock.MagicMock()
        clock.now.return_value = datetime.fromisoformat(stamp)
        clock.fromisoformat = datetime.fromisoformat
        state = {'State': {'StartedAt': stamp, 'Running': False, 'ExitCode': 0}}
        outputs = ['', 'Result=success\nExecMainStatus=0\nActiveState=inactive\n', '{"status":"busy"}', '']
        with patch.object(installer, 'container'), patch.object(WORKERS, 'datetime', clock), \
                patch.object(WORKERS, 'inspect', return_value=state), \
                patch.object(WORKERS, 'command', side_effect=outputs) as command:
            with self.assertRaises(WORKERS.Refused):
                installer.run_once('background')
        self.assertEqual(command.call_args_list[-1].args[0][-4:], ['stop', '--time', '5', 'baci-prefunded-background'])


if __name__ == '__main__':
    unittest.main()
