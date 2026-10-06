import contextlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import checkout_retirement_owner as owner


class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.before = {'phase': 'pending', 'protected': 'same'}
        self.after = {'phase': 'retired_unconfirmed', 'protected': 'same'}
        self.ack = {'status': 'retired_unconfirmed', 'intentId': owner.INTENT, 'releasedKobo': 10000}
        patches = (
            patch.object(owner, 'validate'), patch.object(owner, 'save_exact'), patch.object(owner, 'write_private'),
            patch.object(owner, 'snapshot_sql', return_value='snapshot'),
            patch.object(owner, 'active_configuration', return_value=('sk_test_never_print', 'a' * 64)),
            patch.object(owner, 'verify_unconfirmed', side_effect=lambda *args: self.record('provider-get', {'redacted': True})),
            patch.object(owner, 'upgrade', side_effect=lambda *args: self.record('app-upgrade')),
            patch.object(owner, 'render_transaction', side_effect=lambda *args, **kwargs: 'rehearsal' if kwargs.get('rehearsal') else 'apply'),
            patch.object(owner, 'database', side_effect=lambda sql: self.record(sql, json.dumps(self.ack))),
            patch.object(owner, 'probe', side_effect=[self.before, self.after]),
        )
        self.mocks = [item.start() for item in patches]
        for item in patches:
            self.addCleanup(item.stop)
        recovery = patch.object(owner, 'recover_existing_runtime', side_effect=lambda *args: self.record('existing-recovery'))
        recovery.start()
        self.addCleanup(recovery.stop)
        quiet = patch.object(owner, 'quiet_background', side_effect=self.quiet_background, create=True)
        quiet.start()
        self.addCleanup(quiet.stop)

    @contextlib.contextmanager
    def quiet_background(self, progress):
        self.record('worker-quiet')
        try:
            yield
        finally:
            self.record('worker-restored')

    def record(self, event, result=None):
        self.events.append(event)
        return result

    def test_compatible_app_precedes_release_and_provider_is_rechecked(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            owner.execute_locked(Path('/root/bundle'))
        self.assertEqual(self.events, ['existing-recovery', 'worker-quiet', 'provider-get', 'rehearsal',
                                      'app-upgrade', 'provider-get', 'apply', 'worker-restored'])
        self.assertNotIn('sk_test_never_print', output.getvalue())
        self.assertIn('"phoneReadyForNewPayment": false', output.getvalue())

    def test_refused_rehearsal_never_updates_app_or_releases_reservation(self):
        self.mocks[-2].side_effect = RuntimeError('do not print this secret')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(RuntimeError):
            owner.execute_locked(Path('/root/bundle'))
        self.assertEqual(self.events, ['existing-recovery', 'worker-quiet', 'provider-get', 'worker-restored'])
        self.assertNotIn('do not print', output.getvalue())
        self.assertIn('"databaseApplied": false', output.getvalue())

    def test_failed_apply_stays_unconfirmed_without_a_second_payment(self):
        self.mocks[-2].side_effect = ['rehearsal-result', RuntimeError('unknown commit')]
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(RuntimeError):
            owner.execute_locked(Path('/root/bundle'))
        self.assertIn('"databaseApplied": null', output.getvalue())
        self.assertNotIn('unknown commit', output.getvalue())

    def test_failed_drain_never_verifies_or_applies_and_remains_unconfirmed_for_phone(self):
        output = io.StringIO()
        with patch.object(owner, 'quiet_background', side_effect=owner.Refused('lease-secret')), \
                contextlib.redirect_stdout(output), self.assertRaises(owner.Refused):
            owner.execute_locked(Path('/root/bundle'))
        self.assertEqual(self.events, ['existing-recovery'])
        report = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(report['stage'], 'worker-quiescence')
        self.assertIs(report['databaseApplied'], False)
        self.assertNotIn('lease-secret', output.getvalue())

    def test_failed_schedule_restore_keeps_committed_retirement_honest(self):
        @contextlib.contextmanager
        def failed_restore(progress):
            yield
            raise owner.Refused('restore-secret')

        output = io.StringIO()
        with patch.object(owner, 'quiet_background', side_effect=failed_restore), \
                contextlib.redirect_stdout(output), self.assertRaises(owner.Refused):
            owner.execute_locked(Path('/root/bundle'))
        report = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(report['stage'], 'background-schedule-restore')
        self.assertIs(report['databaseApplied'], True)
        self.assertNotIn('"status": "retired_unconfirmed"', output.getvalue())
        self.assertNotIn('restore-secret', output.getvalue())

    def test_existing_retirement_is_verified_not_released_again(self):
        self.mocks[-1].side_effect = [self.after, {'retired': True, 'recorded': True}]
        with contextlib.redirect_stdout(io.StringIO()):
            owner.execute_locked(Path('/root/bundle'))
        self.assertEqual(self.events, ['existing-recovery', 'app-upgrade'])

    def test_recovery_runs_before_reading_configuration_from_a_stopped_container(self):
        self.mocks[4].side_effect = lambda *args: self.record('mounted-config', ('sk_test_never_print', 'a' * 64))
        with contextlib.redirect_stdout(io.StringIO()):
            owner.execute_locked(Path('/root/bundle'))
        self.assertLess(self.events.index('existing-recovery'), self.events.index('mounted-config'))

    def test_resume_failure_reports_the_previously_committed_retirement(self):
        self.mocks[-1].side_effect = [self.after, {'retired': True, 'recorded': True}]
        self.mocks[-4].side_effect = RuntimeError('app unavailable')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(RuntimeError):
            owner.execute_locked(Path('/root/bundle'))
        self.assertIn('"databaseApplied": true', output.getvalue())

    def test_mounted_configuration_failure_has_its_own_stage_and_safe_source(self):
        self.mocks[4].side_effect = owner.Refused('secret-configuration-canary')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(owner.Refused):
            owner.execute_locked(Path('/root/bundle'))
        reports = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([item['stage'] for item in reports[:-1]], [
            'preflight', 'existing-runtime-recovery', 'mounted-configuration-verification',
        ])
        report = reports[-1]
        self.assertEqual(report['stage'], 'mounted-configuration-verification')
        self.assertEqual(report['reasonCode'], 'REFUSED_CHECK')
        self.assertEqual(report['sourceModule'], 'checkout_retirement_owner.py')
        self.assertGreater(report['sourceLine'], 0)
        self.assertIs(report['databaseApplied'], False)
        self.assertIs(report['newPaymentStarted'], False)
        self.assertNotIn('secret-configuration-canary', output.getvalue())
        self.assertEqual(self.events, ['existing-recovery'])

    def test_main_reports_unexpected_failure_without_printing_secrets_or_traceback(self):
        self.mocks[4].side_effect = RuntimeError('sk_test_unexpected_secret_canary')
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(owner, 'execute', side_effect=owner.execute_locked), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors), \
                self.assertRaises(SystemExit) as stopped:
            owner.main()
        report = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(stopped.exception.code, 1)
        self.assertEqual(report['reasonCode'], 'UNEXPECTED_EXCEPTION')
        self.assertEqual(report['sourceModule'], 'checkout_retirement_owner.py')
        self.assertIs(report['databaseApplied'], False)
        self.assertIs(report['newPaymentStarted'], False)
        self.assertTrue(report['redacted'])
        self.assertNotIn('sk_test_unexpected_secret_canary', output.getvalue())
        self.assertEqual(errors.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
