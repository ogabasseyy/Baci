import copy
import importlib
import os
from pathlib import Path
import signal
import stat
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import runtime_scheduler as scheduler


class QuiescenceTests(unittest.TestCase):
    def setUp(self):
        self.quiet = importlib.import_module('checkout_retirement_quiescence')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.now = 0
        self.wall = self.quiet.DEADLINE_EPOCH - 2000
        self.commands = []
        self.states = {suffix: 'inactive' for suffix in self.quiet.SUFFIXES}
        self.states.update({'background.timer': 'active', 'deadline.timer': 'active'})
        self.files = {suffix: 'static' for suffix in self.states}
        self.overrides = {}
        self.disk_bad = self.cat_bad = False
        self.worker = scheduler.container_contract('background', self.quiet.MANIFEST)
        self.worker['Config']['Env'] = ['PATH=/usr/local/bin:/usr/bin:/bin']
        self.worker['State'] = dict(Running=False, Paused=False, Restarting=False, Dead=False, Pid=0)
        self.remaining = lambda: (0, 0)
        self.probe_override = {}
        self.sleep_action = lambda: None
        self.stop_error = False
        self.events = []
        self.temp = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.lock = Path(self.temp) / 'runner.lock'
        self.lock.touch(mode=0o600)
        self.lock_metadata = {}
        real_fstat = os.fstat

        def metadata(descriptor):
            actual = real_fstat(descriptor)
            value = {key: getattr(actual, key) for key in (
                'st_mode', 'st_size', 'st_nlink', 'st_ino', 'st_dev')}
            changes = self.lock_metadata if stat.S_ISREG(actual.st_mode) else {}
            return SimpleNamespace(**{**value, 'st_uid': 65532, 'st_gid': 65532, **changes})

        patches = {'command': self.command, 'STATE': self.temp, 'root_ancestors': lambda value: None,
                   'read_file': self.read_file}
        for name, value in patches.items():
            self.stack.enter_context(patch.object(self.quiet, name, value))
        self.stack.enter_context(patch.object(self.quiet.os, 'geteuid', return_value=0))
        self.stack.enter_context(patch.object(self.quiet.os, 'fstat', side_effect=metadata))
        self.stack.enter_context(patch.object(self.quiet.time, 'monotonic', side_effect=lambda: self.now))
        self.stack.enter_context(patch.object(self.quiet.time, 'time', side_effect=lambda: self.wall))
        self.stack.enter_context(patch.object(self.quiet.time, 'sleep', side_effect=self.sleep))

    def sleep(self, seconds):
        self.now += seconds
        self.wall += seconds
        self.sleep_action()

    def read_file(self, path, *arguments):
        suffix = path.name.removeprefix('baci-prefunded-')
        return (scheduler.units()[suffix] + ('bad' if self.disk_bad else '')).encode()

    def command(self, arguments, input_text=None, timeout=30):
        import json
        self.commands.append(arguments)
        if arguments[0] == '/usr/bin/systemctl':
            action, suffix = arguments[1], arguments[-1].removeprefix('baci-prefunded-')
            if action == 'show':
                values = dict(LoadState='loaded', FragmentPath='/etc/systemd/system/baci-prefunded-' + suffix,
                    DropInPaths='', NeedDaemonReload='no', UnitFileState=self.files[suffix],
                    ActiveState=self.states[suffix])
                values.update(self.overrides.get(suffix, {}))
                return '\n'.join(key + '=' + value for key, value in values.items()) + '\n'
            if action == 'cat':
                return '# /etc/systemd/system/baci-prefunded-' + suffix + '\n' + (
                    'bad' if self.cat_bad else scheduler.units()[suffix]) + '\n'
            self.assertEqual(suffix, 'background.timer')
            self.assertIn(action, ('start', 'stop'))
            self.states[suffix] = 'active' if action == 'start' else 'inactive'
            if action == 'stop' and self.stop_error:
                raise self.quiet.Refused('Interrupted stop acknowledgement')
            return ''
        self.assertEqual(arguments[:2], ['/usr/bin/docker', '--host=unix:///var/run/docker.sock'])
        if arguments[2:4] == ['image', 'inspect']:
            return json.dumps([{'Config': {'Env': ['PATH=/usr/local/bin:/usr/bin:/bin']}}])
        if arguments[2] == 'inspect':
            self.assertEqual(arguments[-1], 'baci-prefunded-background')
            return json.dumps([self.worker])
        self.assertEqual(arguments[2:5], ['exec', '-i', 'baci-isolated-savings-db-1'])
        self.assertTrue(input_text.startswith('BEGIN READ ONLY;'))
        self.assertTrue(input_text.rstrip().endswith('ROLLBACK;'))
        self.assertNotRegex(input_text, r'(?i)\b(?:UPDATE|DELETE|INSERT|COMMIT|FOR UPDATE)\b')
        self.assertIn("operation.id='d8bcf921-61b3-4647-90e2-5648e4d6967d'", input_text)
        verification, dispatch = self.remaining()
        return json.dumps({**dict(systemIdentifier=self.quiet.SYSTEM, database='postgres', withinDeadline=True,
                                 verification=verification, dispatch=dispatch), **self.probe_override})

    def context(self):
        return self.quiet.quiet_background(self.events.append)

    def mutations(self):
        return [(arguments[1], arguments[-1]) for arguments in self.commands
                if arguments[0] == '/usr/bin/systemctl' and arguments[1] in ('start', 'stop')]

    def test_drains_naturally_then_waits_both_leases_holding_existing_lock(self):
        self.states['background.service'] = 'activating'
        self.worker['State'].update(Running=True, Pid=42)
        def finish():
            if self.now >= 2:
                self.states['background.service'] = 'inactive'
                self.worker['State'].update(Running=False, Pid=0)
        self.sleep_action = finish
        self.remaining = lambda: (max(0, 5 - self.now), max(0, 7 - self.now))
        with self.context():
            self.assertEqual(self.now, 7)
            self.assertEqual(self.states['background.timer'], 'inactive')
            with self.lock.open() as handle, self.assertRaises(BlockingIOError):
                self.quiet.fcntl.flock(handle.fileno(), self.quiet.fcntl.LOCK_EX | self.quiet.fcntl.LOCK_NB)
        self.assertEqual(self.mutations(), [('stop', 'baci-prefunded-background.timer'),
                                          ('start', 'baci-prefunded-background.timer')])
        self.assertEqual(self.lock.read_bytes(), b'')
        with self.lock.open() as handle:
            self.quiet.fcntl.flock(handle.fileno(), self.quiet.fcntl.LOCK_EX | self.quiet.fcntl.LOCK_NB)

    def test_originally_inactive_timer_is_never_started(self):
        self.states['background.timer'] = 'inactive'
        with self.context():
            pass
        self.assertEqual(self.mutations(), [])

    def test_restore_on_body_failure_and_lost_stop_acknowledgement(self):
        for lost in (False, True):
            self.stop_error = lost
            with self.assertRaises(self.quiet.Refused), self.context():
                raise self.quiet.Refused('Owner rehearsal failed')
            self.assertEqual(self.states['background.timer'], 'active')

    def test_unit_bytes_dropins_reload_and_container_drift_refuse_before_stop(self):
        changes = [('disk_bad', True), ('cat_bad', True)]
        for attribute, value in changes:
            setattr(self, attribute, value)
            with self.assertRaises(self.quiet.Refused), self.context():
                self.fail('Unsafe context entered')
            setattr(self, attribute, False)
        for field, value in [('DropInPaths', '/etc/override.conf'), ('NeedDaemonReload', 'yes'),
                             ('FragmentPath', '/run/foreign'), ('LoadState', 'not-found')]:
            self.overrides['deadline.service'] = {field: value}
            with self.assertRaises(self.quiet.Refused), self.context():
                self.fail('Unsafe context entered')
        self.overrides.clear()
        original = copy.deepcopy(self.worker)
        for section, field, value in [('Config', 'Env', ['SECRET=bad']), ('Image', None, 'foreign'),
                                      ('HostConfig', 'Privileged', True)]:
            self.worker = copy.deepcopy(original)
            if field:
                self.worker[section][field] = value
            else:
                self.worker[section] = value
            with self.assertRaises(self.quiet.Refused), self.context():
                self.fail('Unsafe context entered')
        self.assertEqual(self.mutations(), [])

    def test_lock_is_not_created_or_followed_and_invalid_metadata_is_refused(self):
        for changes in ({'st_uid': 0}, {'st_gid': 0}, {'st_mode': stat.S_IFREG | 0o644},
                        {'st_nlink': 2}, {'st_size': 1}):
            self.lock_metadata = changes
            with self.assertRaises(self.quiet.Refused), self.context():
                self.fail('Unsafe lock accepted')
            self.assertEqual(self.states['background.timer'], 'active')
        self.lock_metadata = {}
        self.lock.unlink()
        for symlink in (False, True):
            if symlink:
                self.lock.symlink_to(Path(self.temp) / 'absent')
            with self.assertRaises((OSError, self.quiet.Refused)), self.context():
                self.fail('Missing or symlink lock accepted')
            self.assertFalse((Path(self.temp) / 'absent').exists())
        self.assertEqual(self.states['background.timer'], 'active')

    def test_busy_runner_refuses_without_stopping_job_or_changing_lock(self):
        with self.lock.open() as handle:
            self.quiet.fcntl.flock(handle.fileno(), self.quiet.fcntl.LOCK_EX | self.quiet.fcntl.LOCK_NB)
            with self.assertRaises((BlockingIOError, self.quiet.Refused)), self.context():
                self.fail('Busy lock accepted')
        self.assertEqual(self.states['background.timer'], 'active')

    def test_job_drain_has_490_second_limit_without_service_stop(self):
        self.states['background.service'] = 'activating'
        with self.assertRaises(self.quiet.Refused), self.context():
            self.fail('Unfinished worker accepted')
        self.assertEqual(self.now, 490)
        self.assertEqual(self.states['background.timer'], 'active')

    def test_lease_wait_is_bounded_and_rejects_overlong_or_invalid_results(self):
        self.remaining = lambda: (1, 0)
        with self.assertRaises(self.quiet.Refused), self.context():
            self.fail('Renewing lease accepted')
        self.assertEqual(self.now, 310)
        for value in (301, -1, True, '60', float('nan')):
            self.remaining = lambda: (value, 0)
            with self.assertRaises(self.quiet.Refused), self.context():
                self.fail('Invalid lease accepted')
        self.assertEqual(self.states['background.timer'], 'active')

    def test_deadline_during_wait_or_body_never_resurrects_timer(self):
        self.wall = self.quiet.DEADLINE_EPOCH - 1
        self.remaining = lambda: (20, 0)
        with self.assertRaises(self.quiet.Refused), self.context():
            self.fail('Expired drain accepted')
        self.assertEqual(self.mutations(), [('stop', 'baci-prefunded-background.timer')])
        self.wall -= 100
        self.remaining = lambda: (0, 0)
        self.states['background.timer'] = 'active'
        with self.context():
            self.wall = self.quiet.DEADLINE_EPOCH
        self.assertEqual(self.states['background.timer'], 'inactive')

    def test_changed_unit_file_state_or_content_blocks_unsafe_restore(self):
        for change in ('state', 'content'):
            self.states['background.timer'] = 'active'
            self.files['background.timer'] = 'static'
            self.cat_bad = False
            with self.assertRaises(self.quiet.Refused), self.context():
                if change == 'state':
                    self.files['background.timer'] = 'enabled'
                else:
                    self.cat_bad = True
            self.assertEqual(self.states['background.timer'], 'inactive')

    def test_catchable_termination_releases_lock_restores_timer_and_handlers(self):
        previous = signal.getsignal(signal.SIGTERM)
        with self.assertRaises(self.quiet.Refused), self.context():
            signal.raise_signal(signal.SIGTERM)
        self.assertEqual(self.states['background.timer'], 'active')
        self.assertEqual(signal.getsignal(signal.SIGTERM), previous)

    def test_wrong_database_or_unknown_deadline_never_enters_owner_body(self):
        for changes in ({'systemIdentifier': 'other'}, {'database': 'other'},
                        {'withinDeadline': False}, {'withinDeadline': 1}, {'verification': None}):
            self.probe_override = changes
            with self.assertRaises(self.quiet.Refused), self.context():
                self.fail('Unknown scope accepted')
            self.assertEqual(self.states['background.timer'], 'active')

    def test_expired_approval_or_nonroot_never_stops_timer(self):
        with patch.object(self.quiet.os, 'geteuid', return_value=501), \
                self.assertRaises(self.quiet.Refused), self.context():
            self.fail('Nonroot accepted')
        self.wall = self.quiet.DEADLINE_EPOCH
        with self.assertRaises(self.quiet.Refused), self.context():
            self.fail('Expired approval accepted')
        self.assertEqual(self.mutations(), [])

    def test_container_inspection_shares_remaining_drain_budget(self):
        budgets = []
        def delayed(arguments, input_text=None, timeout=30):
            budgets.append(timeout)
            self.now += 3
            return self.command(arguments, input_text, timeout)
        with patch.object(self.quiet, 'command', side_effect=delayed):
            self.quiet._worker(5)
        self.assertEqual(budgets, [5, 2])

    def test_restore_crossing_deadline_with_or_without_acknowledgement_withdraws_timer(self):
        for ambiguous in (False, True):
            self.wall = self.quiet.DEADLINE_EPOCH - 100
            self.states['background.timer'] = 'active'
            def crossing(arguments, input_text=None, timeout=30):
                result = self.command(arguments, input_text, timeout)
                if arguments[:2] == ['/usr/bin/systemctl', 'start']:
                    self.wall = self.quiet.DEADLINE_EPOCH
                    if ambiguous:
                        raise self.quiet.Refused('Start acknowledgement lost')
                return result
            with self.subTest(ambiguous=ambiguous), patch.object(self.quiet, 'command', side_effect=crossing), \
                    self.assertRaises(self.quiet.Refused), self.context():
                pass
            self.assertEqual(self.states['background.timer'], 'inactive')
            self.assertEqual(self.mutations()[-1], ('stop', 'baci-prefunded-background.timer'))


if __name__ == '__main__':
    unittest.main()
