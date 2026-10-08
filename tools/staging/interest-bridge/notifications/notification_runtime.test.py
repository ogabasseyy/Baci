import unittest
from unittest.mock import Mock, patch

from notification_contract import CHECK, DEADLINE, SERVICE, STOPPER, TARGET_EPOCH, TIMER, UNIT_ROOT, Refused
from notification_runtime import readonly_check, schedule, verify_check_command, verify_credential, verify_deadline


class NotificationRuntimeTests(unittest.TestCase):
    def unit(self, name):
        return dict(FragmentPath=UNIT_ROOT + name, LoadState='loaded', DropInPaths='', NeedDaemonReload='no',
                    Transient='no', ActiveState='active', SubState='waiting', UnitFileState='enabled')

    def states(self, name):
        value = self.unit(name)
        if name == DEADLINE:
            value.update(Triggers=STOPPER, NextElapseUSecRealtime='Tue 2026-10-06 15:59:10 UTC')
        elif name == STOPPER:
            value['ExecStart'] = '{ path=/usr/bin/systemctl ; argv[]=/usr/bin/systemctl stop ' + ' '.join((TIMER, SERVICE, CHECK)) + ' ; ignore_errors=no ; }'
        elif name == TIMER:
            value['Triggers'] = SERVICE
        return value

    def test_deadline_is_effectively_armed_before_notification_timer(self):
        run = Mock(return_value=str(TARGET_EPOCH))
        with patch('notification_runtime.state', side_effect=lambda command, name: self.states(name)):
            schedule(run)
        commands = [call.args[0] for call in run.call_args_list]
        deadline = ['/usr/bin/systemctl', 'enable', '--now', DEADLINE]
        notification = ['/usr/bin/systemctl', 'enable', '--now', TIMER]
        self.assertLess(commands.index(deadline), commands.index(notification))
        self.assertTrue(any(command[0] == '/usr/bin/date' for command in commands[commands.index(deadline):commands.index(notification)]))

    def test_wrong_next_deadline_or_stop_targets_prevents_notification_schedule(self):
        for failure in ('date', 'targets'):
            run = Mock(return_value=str(TARGET_EPOCH - 1 if failure == 'date' else TARGET_EPOCH))
            def states(command, name):
                value = self.states(name)
                if name == STOPPER and failure == 'targets':
                    value['ExecStart'] = '{ argv[]=/usr/bin/systemctl stop unrelated.service ; ignore_errors=no ; }'
                return value
            with self.subTest(failure=failure), patch('notification_runtime.state', side_effect=states), self.assertRaises(Refused):
                schedule(run)
            self.assertNotIn(['/usr/bin/systemctl', 'enable', '--now', TIMER], [call.args[0] for call in run.call_args_list])

    def test_deadline_without_next_fire_time_refuses(self):
        with patch('notification_runtime.state', return_value=dict(self.states(DEADLINE), NextElapseUSecRealtime='')), self.assertRaisesRegex(Refused, 'deadline-not-armed'):
            verify_deadline(Mock())

    def test_success_result_from_old_or_skipped_check_is_not_fresh_tls_proof(self):
        previous = dict(Result='success', ExecMainStatus='0', ExecMainCode='1', ActiveState='inactive', SubState='dead', ExecMainStartTimestampMonotonic='100')
        for changed in (previous, dict(previous, ExecMainStartTimestampMonotonic='0', ExecMainCode='0'), dict(previous, Result='failed')):
            stopped = dict(self.unit(CHECK), ActiveState='inactive', SubState='dead')
            command = Mock(return_value='')
            with self.subTest(changed=changed), patch('notification_runtime.state', side_effect=[previous, changed, stopped]), self.assertRaises(Refused):
                readonly_check(command)
            self.assertIn(['/usr/bin/systemctl', 'stop', CHECK], [call.args[0] for call in command.call_args_list])

    def test_retained_fresh_success_is_stopped_and_verified_inactive(self):
        previous = dict(ExecMainStartTimestampMonotonic='0')
        stopped = dict(self.unit(CHECK), ActiveState='inactive', SubState='dead')
        for code in ('1', 'exited'):
            current = dict(Result='success', ExecMainStatus='0', ExecMainCode=code, ActiveState='active', SubState='exited', ExecMainStartTimestampMonotonic='101')
            command = Mock(return_value='')
            with self.subTest(code=code), patch('notification_runtime.state', side_effect=[previous, current, stopped]) as observed:
                readonly_check(command)
            self.assertEqual([call.args[0] for call in command.call_args_list], [
                ['/usr/bin/systemctl', 'start', CHECK], ['/usr/bin/systemctl', 'stop', CHECK]])
            self.assertEqual(observed.call_count, 3)

    def test_zero_or_stale_start_and_default_code_never_prove_retained_success(self):
        previous = dict(ExecMainStartTimestampMonotonic='100')
        retained = dict(Result='success', ExecMainStatus='0', ExecMainCode='1', ActiveState='active', SubState='exited', ExecMainStartTimestampMonotonic='101')
        stopped = dict(self.unit(CHECK), ActiveState='inactive', SubState='dead')
        for key, wrong in (('ExecMainStartTimestampMonotonic', '0'), ('ExecMainStartTimestampMonotonic', '100'), ('ExecMainCode', '0'), ('ExecMainStatus', '1'), ('SubState', 'running'), ('ActiveState', 'inactive')):
            with self.subTest(key=key, wrong=wrong), patch('notification_runtime.state', side_effect=[previous, dict(retained, **{key: wrong}), stopped]), self.assertRaisesRegex(Refused, 'readonly-check-not-executed-successfully'):
                readonly_check(Mock(return_value=''))

    def test_successful_check_with_unconfirmed_stop_refuses(self):
        current = dict(Result='success', ExecMainStatus='0', ExecMainCode='1', ActiveState='active', SubState='exited', ExecMainStartTimestampMonotonic='101')
        with patch('notification_runtime.state', side_effect=[dict(ExecMainStartTimestampMonotonic='0'), current, dict(self.unit(CHECK), SubState='exited')]), self.assertRaisesRegex(Refused, 'notification-not-quiescent'):
            readonly_check(Mock(return_value=''))

    def test_loaded_check_command_must_execute_check_with_fixed_credential_and_database(self):
        value = dict(RemainAfterExit='yes', ExecStart='{ argv[]=/bin/sh -eu -c export SAVINGS_NOTIFICATIONS_DATABASE_URL="$(/usr/bin/cat "$CREDENTIALS_DIRECTORY/db-url")"; export SAVINGS_NOTIFICATIONS_DATABASE_NAME=postgres SAVINGS_NOTIFICATIONS_ENABLED=true; exec /usr/bin/node /opt/baci-savings-notifications/worker.mjs --check ; ignore_errors=no ; }')
        verify_check_command(value)
        for fragment in (' --check', '$CREDENTIALS_DIRECTORY/db-url', 'DATABASE_NAME=postgres'):
            with self.subTest(fragment=fragment), self.assertRaisesRegex(Refused, 'effective-readonly-check-command'):
                verify_check_command(dict(value, ExecStart=value['ExecStart'].replace(fragment, 'unsafe')))
        with self.assertRaisesRegex(Refused, 'effective-readonly-check-command'):
            verify_check_command(dict(value, RemainAfterExit='no'))

    def test_credential_refuses_plaintext_or_wrong_tls_target(self):
        from pathlib import Path
        from types import SimpleNamespace
        safe = b'postgresql://baci_savings_notifications_worker:opaque@piggyvest-db.staging.baci.internal:5432/postgres?sslmode=verify-full&sslrootcert=/opt/baci-savings-notifications/postgres-ca.pem\n'
        metadata = SimpleNamespace(st_mode=0o40700, st_uid=0)
        for unsafe in (safe.replace(b'verify-full', b'disable'), safe.replace(b'piggyvest-db.staging.baci.internal', b'other.example')):
            with self.subTest(unsafe=unsafe), patch.object(Path, 'lstat', return_value=metadata), patch('notification_runtime.read_file', return_value=unsafe), self.assertRaisesRegex(Refused, 'credential-tls-target'):
                verify_credential()
        with patch.object(Path, 'lstat', return_value=metadata), patch('notification_runtime.read_file', return_value=safe):
            self.assertEqual(verify_credential(), safe)


if __name__ == '__main__':
    unittest.main()
