from contextlib import ExitStack
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from notification_contract import OLD, TARGET, UNIT_ROOT, SERVICE, CHECK, DEADLINE, Refused
from notification_database import expected_routines, expected_state
import notification_owner as owner


class NotificationOwnerTests(unittest.TestCase):
    def setup_helpers(self, stack):
        originals = {UNIT_ROOT + name: b'original' for name in (SERVICE, CHECK, DEADLINE)}
        candidates = {path: b'candidate' for path in originals}
        snapshot = lambda command, sources, expiry: dict(expected_state(expiry), routines=expected_routines(), eventCount=5, deliveryCount=0)
        mocks = {}
        for name, value in (
            ('database_sources', Mock(return_value=('template', 'query', 'guard'))),
            ('preflight', Mock(return_value=(originals, candidates, b'private-credential'))),
            ('database_snapshot', Mock(side_effect=snapshot)),
            ('change_expiry', Mock()), ('backup_candidates', Mock()), ('replace_file', Mock()),
            ('write_new', Mock()), ('verify_installed', Mock()), ('readonly_check', Mock()),
            ('schedule', Mock()), ('verify_deadline', Mock()), ('ensure_window', Mock()),
            ('restore', Mock(return_value=[])),
        ):
            mocks[name] = stack.enter_context(patch.object(owner, name, value))
        stack.enter_context(patch.object(Path, 'exists', return_value=False))
        return mocks

    def test_success_rehearses_commits_checks_then_schedules(self):
        with ExitStack() as stack:
            mocks = self.setup_helpers(stack)
            sequence = []
            mocks['change_expiry'].side_effect = lambda *arguments, **options: sequence.append('commit' if options.get('commit') else 'rollback')
            mocks['readonly_check'].side_effect = lambda command: sequence.append('tls-check')
            mocks['schedule'].side_effect = lambda command: sequence.append('schedule')
            report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
        self.assertEqual(sequence, ['rollback', 'commit', 'tls-check', 'schedule'])
        self.assertEqual(report['status'], 'notifications-scheduled')
        self.assertEqual(report['expiry'], TARGET)
        mocks['restore'].assert_not_called()

    def test_pin_dropin_unsafe_role_or_expired_target_refuses_before_live_changes(self):
        for error in ('predecessor-pin', 'effective-unit', 'unsafe-role', 'renewal-window'):
            with self.subTest(error=error), ExitStack() as stack:
                mocks = self.setup_helpers(stack)
                mocks['preflight'].side_effect = Refused(error)
                report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
                self.assertEqual(report['status'], 'refused')
                self.assertFalse(report['databaseCommitted'])
                mocks['change_expiry'].assert_not_called()
                mocks['replace_file'].assert_not_called()
                mocks['schedule'].assert_not_called()

    def test_partial_unit_failure_attempts_recovery_and_reports_recovery_error(self):
        with ExitStack() as stack:
            mocks = self.setup_helpers(stack)
            mocks['replace_file'].side_effect = Refused('unit-replacement-postcondition')
            mocks['restore'].return_value = ['unit-restore-unconfirmed']
            report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
        self.assertEqual(report['stage'], 'unit-installation')
        self.assertFalse(report['recoveryVerified'])
        self.assertEqual(report['recoveryFailures'], ['unit-restore-unconfirmed'])
        mocks['schedule'].assert_not_called()

    def test_ambiguous_commit_is_reported_and_never_retried(self):
        with ExitStack() as stack:
            mocks = self.setup_helpers(stack)
            def change(*arguments, **options):
                if options.get('commit'):
                    raise Refused('command-unconfirmed')
            mocks['change_expiry'].side_effect = change
            report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
        self.assertIsNone(report['databaseCommitted'])
        self.assertEqual(mocks['change_expiry'].call_count, 2)
        mocks['restore'].assert_called_once()
        mocks['replace_file'].assert_not_called()

    def test_readonly_check_failure_never_schedules(self):
        with ExitStack() as stack:
            mocks = self.setup_helpers(stack)
            mocks['readonly_check'].side_effect = Refused('readonly-check-not-executed-successfully')
            report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
        self.assertEqual(report['stage'], 'readonly-tls-check')
        mocks['schedule'].assert_not_called()
        mocks['restore'].assert_called_once()

    def test_failed_activation_receipt_stops_and_recovers_after_scheduling(self):
        with ExitStack() as stack:
            mocks = self.setup_helpers(stack)
            def write(path, content):
                if path.name == 'activation-result.json':
                    raise OSError('private-write-error')
            mocks['write_new'].side_effect = write
            report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
        self.assertEqual(report['stage'], 'audit-result-write')
        self.assertTrue(report['notificationDeliveryMayHaveOccurred'])
        self.assertTrue(report['recoveryVerified'])
        self.assertEqual(report['priorReport']['status'], 'notifications-scheduled')
        mocks['restore'].assert_called_once()

    def test_audit_write_failure_retains_prior_stage_error_and_recovery_failures(self):
        with ExitStack() as stack:
            mocks = self.setup_helpers(stack)
            mocks['readonly_check'].side_effect = Refused('readonly-check-not-executed-successfully')
            mocks['restore'].side_effect = [['role-restore-unconfirmed'], []]
            def write(path, content):
                if path.name == 'activation-result.json':
                    raise OSError('private-write-error')
            mocks['write_new'].side_effect = write
            report = owner.activate(Path('/root/reviewed-notifications'), Mock(return_value=''))
        self.assertEqual(report['stage'], 'audit-result-write')
        self.assertEqual(report['error'], 'audit-result-unconfirmed')
        self.assertTrue(report['recoveryVerified'])
        self.assertEqual(report['recoveryFailures'], [])
        self.assertEqual(report['priorReport']['stage'], 'readonly-tls-check')
        self.assertEqual(report['priorReport']['error'], 'readonly-check-not-executed-successfully')
        self.assertFalse(report['priorReport']['recoveryVerified'])
        self.assertEqual(report['priorReport']['recoveryFailures'], ['role-restore-unconfirmed'])
        self.assertEqual(mocks['restore'].call_count, 2)

    def restore_helpers(self, stack, expiry=TARGET, unit_content=b'candidate'):
        path = UNIT_ROOT + SERVICE
        credential_path = '/etc/baci/piggyvest-staging/notifications/database-url'
        originals, candidates = {path: b'original'}, {path: b'candidate'}
        contents = {path: unit_content, credential_path: b'private-credential'}
        observed = dict(expected_state(expiry), routines=expected_routines())
        restored = dict(expected_state(OLD), routines=expected_routines())
        def replace(path, expected, content):
            self.assertEqual(contents[path], expected)
            contents[path] = content
        mocks = {}
        for name, value in (
            ('inspect_database', Mock(side_effect=[observed, restored])),
            ('change_expiry', Mock()), ('state', Mock(return_value=dict(ActiveState='inactive', SubState='dead'))),
            ('read_file', Mock(side_effect=lambda path, mode: contents[str(path)])),
            ('replace_file', Mock(side_effect=replace)), ('quiescent', Mock()),
        ):
            mocks[name] = stack.enter_context(patch.object(owner, name, value))
        arguments = (('template', 'query', 'guard'), originals, candidates, b'private-credential')
        return arguments, mocks

    def test_restore_stop_failure_returns_without_database_or_unit_changes(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack)
            command = Mock(side_effect=[Refused('command-failed'), '', ''])
            failures = owner.restore(command, *arguments, commit_attempted=True, install_attempted=True)
        self.assertEqual(failures, ['stop-or-disable-unconfirmed'])
        mocks['inspect_database'].assert_not_called()
        mocks['replace_file'].assert_not_called()

    def test_restore_requires_quiescence_before_database_or_unit_changes(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack)
            mocks['state'].return_value = dict(ActiveState='active', SubState='running')
            failures = owner.restore(Mock(return_value=''), *arguments, commit_attempted=True, install_attempted=True)
        self.assertEqual(failures, ['quiescence-unconfirmed'])
        mocks['inspect_database'].assert_not_called()
        mocks['replace_file'].assert_not_called()

    def test_restore_target_expiry_commits_only_the_old_expiry(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack)
            command = Mock(return_value='')
            failures = owner.restore(command, *arguments, commit_attempted=True, install_attempted=False)
        self.assertEqual(failures, [])
        mocks['change_expiry'].assert_called_once_with(command, *arguments[0], commit=True, restore=True)

    def test_restore_old_expiry_skips_a_second_database_change(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack, expiry=OLD)
            failures = owner.restore(Mock(return_value=''), *arguments, commit_attempted=True, install_attempted=False)
        self.assertEqual(failures, [])
        mocks['change_expiry'].assert_not_called()
        self.assertEqual(mocks['inspect_database'].call_count, 2)

    def test_restore_unexpected_expiry_reports_failure_without_overwriting_it(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack, expiry='2026-10-07T15:59:10Z')
            failures = owner.restore(Mock(return_value=''), *arguments, commit_attempted=True, install_attempted=False)
        self.assertEqual(failures, ['role-restore-unconfirmed'])
        mocks['change_expiry'].assert_not_called()

    def test_restore_replaces_known_candidate_units_with_originals(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack)
            command = Mock(return_value='')
            failures = owner.restore(command, *arguments, commit_attempted=False, install_attempted=True)
        self.assertEqual(failures, [])
        mocks['replace_file'].assert_called_once_with(UNIT_ROOT + SERVICE, b'candidate', b'original')
        self.assertIn(['/usr/bin/systemctl', 'daemon-reload'], [call.args[0] for call in command.call_args_list])
        mocks['quiescent'].assert_called_once_with(command)

    def test_restore_refuses_unknown_unit_bytes_without_overwriting_them(self):
        with ExitStack() as stack:
            arguments, mocks = self.restore_helpers(stack, unit_content=b'unexpected')
            failures = owner.restore(Mock(return_value=''), *arguments, commit_attempted=False, install_attempted=True)
        self.assertEqual(failures, ['unit-restore-unconfirmed'])
        mocks['replace_file'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
