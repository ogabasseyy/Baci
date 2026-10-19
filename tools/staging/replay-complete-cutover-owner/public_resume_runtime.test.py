from datetime import datetime, timezone
import json
import hashlib
import sys
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

import public_resume_runtime as subject


NOW = datetime(2026, 10, 3, 20, tzinfo=timezone.utc)


def jobs(rows):
    return json.dumps(dict(type='a(usssoo)', data=[rows]))


def row(identifier=47, unit=subject.resume.SERVICE):
    return [identifier, unit, 'start', 'running', '/org/freedesktop/systemd1/job/' + str(identifier), '/unit']


def commands(arguments):
    return dict(type='a(sasbttttuii)', data=[[argv[0], argv, False, 0, 0, 0, 0, 0, 0, 0] for argv in arguments])


class Tests(unittest.TestCase):
    def setUp(self):
        self.runtime = subject.PublicRuntime()
        self.runtime.command = Mock()
        self.runtime.clock = Mock(return_value=NOW)
        self.runtime.before_start = Mock()

    def test_observed_empty_listjobs_abi_and_known_job_membership(self):
        self.runtime.command.return_value = jobs([])
        self.assertEqual(self.runtime.jobs(), [])
        self.runtime.command.return_value = jobs([row()])
        self.assertEqual(self.runtime.jobs(), [47])
        self.runtime.job = 47
        self.runtime.command.return_value = jobs([row(unit='foreign.service')])
        with self.assertRaises(ValueError):
            self.runtime.jobs()

    def test_unknown_duplicate_boolean_or_malformed_jobs_refuse(self):
        for value in (dict(type='unknown', data=[[]]), dict(type='a(usssoo)', data=[]),
                dict(type='a(usssoo)', data=[[row(), row()]]), dict(type='a(usssoo)', data=[[row(True)]])):
            with self.subTest(value=value):
                self.runtime.command.return_value = json.dumps(value)
                with self.assertRaises(ValueError):
                    self.runtime.jobs()

    def test_exact_start_tracks_job_and_removed_job_not_client_exit(self):
        self.runtime.command.side_effect = [jobs([]), json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/47'])),
            jobs([]), jobs([])]
        self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
        self.runtime.properties = Mock(return_value=dict(ActiveState='active'))
        result = self.runtime.start_job_state(subject.resume.SERVICE, NOW)
        self.assertTrue(result['terminal'])
        self.assertEqual(result['jobId'], 47)
        self.assertEqual(self.runtime.command.call_args_list[1].args[0][-4:],
            ['StartUnit', 'ss', subject.resume.SERVICE, 'fail'])
        with self.assertRaises(ValueError):
            self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)

    def test_pending_or_activating_job_is_not_terminal(self):
        self.runtime.job, self.runtime.submitted = 47, NOW
        self.runtime.properties = Mock(return_value=dict(ActiveState='activating'))
        self.runtime.command.return_value = jobs([row()])
        result = self.runtime.start_job_state(subject.resume.SERVICE, NOW)
        self.assertFalse(result['terminal'])
        self.assertEqual(result['pendingJobs'], [47])

    def test_scalar_or_multiple_objectpaths_refuse_and_no_retry(self):
        for data in ('/org/freedesktop/systemd1/job/47', [], ['/job/47', '/job/48']):
            with self.subTest(data=data):
                runtime = subject.PublicRuntime()
                runtime.command = Mock(side_effect=[jobs([]), json.dumps(dict(type='o', data=data))])
                runtime.clock = Mock(return_value=NOW)
                runtime.before_start = Mock()
                with self.assertRaises(ValueError):
                    runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
                self.assertTrue(runtime.attempted)
                self.assertIsNone(runtime.job)

    def test_start_commands_share_one_thirty_second_monotonic_budget(self):
        self.runtime.command.side_effect = [jobs([]), json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/47'])), jobs([])]
        with patch.object(subject.time, 'monotonic', side_effect=[100, 101, 126, 127, 128, 129]):
            self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
        self.assertEqual([call.args[1] for call in self.runtime.command.call_args_list], [10, 4, 2])

    def test_overbudget_empty_job_result_cannot_claim_start_success(self):
        self.runtime.command.side_effect = [jobs([]), json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/47'])), jobs([])]
        with patch.object(subject.time, 'monotonic', side_effect=[100, 101, 102, 129, 129, 131]):
            with self.assertRaises(ValueError):
                self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
        self.assertEqual(self.runtime.job, 47)

    def test_seal_drift_at_last_guard_does_not_send_startunit(self):
        self.runtime.command.return_value = jobs([])
        self.runtime.before_start.side_effect = ValueError('source drift')
        with self.assertRaises(ValueError):
            self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
        self.assertEqual(self.runtime.command.call_count, 1)
        self.assertNotIn('StartUnit', self.runtime.command.call_args.args[0])

    def test_unknown_submission_or_foreign_service_refuses(self):
        with self.assertRaises(ValueError):
            self.runtime.start_job_state(subject.resume.SERVICE, NOW)
        self.runtime.job, self.runtime.submitted = 47, NOW
        with self.assertRaises(ValueError):
            self.runtime.start_job_state('financial.service', NOW)

    def test_start_timeout_does_not_retry_even_if_job_identity_unconfirmed(self):
        self.runtime.command.side_effect = [jobs([]), TimeoutError('private material')]
        with self.assertRaises(TimeoutError):
            self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
        self.runtime.command.reset_mock(side_effect=True)
        with self.assertRaises(ValueError):
            self.runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)
        self.runtime.command.assert_not_called()

    def test_mutation_scope_only_exact_public_start_and_cid_stop(self):
        for command in ([*subject.resume.DOCKER, 'start', subject.resume.CID],
                ['/usr/bin/systemctl', 'start', 'baci-prefunded-background.service'],
                ['/usr/bin/systemctl', 'restart', subject.resume.SERVICE]):
            with self.subTest(command=command), self.assertRaises(ValueError):
                self.runtime.run(command, timeout=30)
        self.runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.runtime.command.assert_called_once()

    def test_effective_commands_are_actual_argv_not_assumptions(self):
        raw = commands([['/usr/bin/systemctl', 'stop', 'public.service']])
        self.assertEqual(self.runtime.commands(raw, 1), [['/usr/bin/systemctl', 'stop', 'public.service']])
        raw['data'][0][2] = True
        with self.assertRaises(ValueError):
            self.runtime.commands(raw, 1)

    def test_property_missing_duplicate_or_unknown_keys_refuse(self):
        for raw in ('ActiveState=active\nActiveState=active\n', 'Foreign=active\n', ''):
            with self.subTest(raw=raw):
                self.runtime.command.return_value = raw
                with self.assertRaises(ValueError):
                    self.runtime.properties(subject.resume.SERVICE, ('ActiveState',))

    def test_actual_separate_execstart_lines_preserve_both_commands_and_full_output(self):
        first = '{ path=/usr/bin/systemctl ; argv[]=/usr/bin/systemctl stop baci-prefunded-public.service ; ignore_errors=no ; }'
        second = '{ path=/usr/bin/docker ; argv[]=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 5 baci-prefunded-public ; ignore_errors=no ; }'
        self.runtime.command.return_value = 'ExecStart=' + first + '\nExecStart=' + second + '\nDropInPaths=\nNeedDaemonReload=no\n'
        result = self.runtime.properties('baci-prefunded-public-deadline.service',
            ('ExecStart', 'DropInPaths', 'NeedDaemonReload'))
        self.assertEqual(result['ExecStart'], first + '\n' + second)
        self.assertIn('--no-pager', self.runtime.command.call_args.args[0])
        self.assertIn('--full', self.runtime.command.call_args.args[0])

    def test_duplicate_nonexecstart_properties_still_refuse(self):
        for field in ('DropInPaths', 'NeedDaemonReload', 'ExecCondition', 'ExecStopPost'):
            with self.subTest(field=field):
                self.runtime.command.return_value = field + '=value\n' + field + '=value\n'
                with self.assertRaises(ValueError):
                    self.runtime.properties(subject.resume.SERVICE, (field,))

    def test_deadline_validates_repeated_execstart_order_and_exact_targets(self):
        timer = ('ActiveState=active\nSubState=waiting\nUnit=baci-prefunded-public-deadline.service\n'
            'NextElapseUSecRealtime=Tue 2026-10-06 15:59:10 UTC\nAccuracyUSec=1s\n'
            'RandomizedDelayUSec=0\nDropInPaths=\nNeedDaemonReload=no\n')
        starts = [['/usr/bin/systemctl', 'stop', subject.resume.SERVICE],
            [*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.NAME]]
        for lines, accepted in ((starts, True), (starts[::-1], False),
                ([starts[0], [*subject.resume.DOCKER, 'start', subject.resume.NAME]], False), (starts * 2, False)):
            with self.subTest(lines=lines), patch.object(subject.hashlib, 'sha256', side_effect=[
                    Mock(hexdigest=Mock(return_value=subject.TIMER_PIN)),
                    Mock(hexdigest=Mock(return_value=subject.STOPPER_PIN))]):
                self.runtime.read = Mock(return_value=(b'pinned unit', {}))
                path = '/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2ddeadline_2eservice'
                self.runtime.command.side_effect = [timer, 'DropInPaths=\nNeedDaemonReload=no\n',
                    json.dumps(dict(type='o', data=[path])), json.dumps(commands(lines))]
                if accepted:
                    self.assertEqual(self.runtime.deadline()['epoch'], 1791302350)
                else:
                    with self.assertRaises(ValueError):
                        self.runtime.deadline()

    def test_stopped_unit_requires_no_timestamp_but_active_uses_exact_microseconds(self):
        raw = dict(FragmentPath=subject.resume.UNIT, DropInPaths='', NeedDaemonReload='no', LoadState='loaded',
            Transient='no', Restart='no', ActiveState='inactive', SubState='dead', Result='success',
            ExecMainStatus='0', MainPID='0', InvocationID='', Environment='', PassEnvironment='', UnsetEnvironment='')
        self.runtime.unit_commands = Mock(return_value={field: [['/bin/sh', '-c', 'fixed']]
            for field in ('ExecCondition', 'ExecStart', 'ExecStopPost')})
        self.runtime.properties = Mock(return_value=raw)
        protected = patch.object(subject.resume, '_read', return_value=b'[Service]\nRestart=no\n')
        protected.start()
        self.addCleanup(protected.stop)
        self.assertNotIn('startedAt', self.runtime.unit_state())
        self.runtime.command.assert_not_called()
        raw.update(ActiveState='active', MainPID='42')
        self.runtime.command.return_value = json.dumps(dict(type='t', data=1791057600123456))
        result = self.runtime.unit_state()
        self.assertEqual(result['startedAt'], '2026-10-03T20:00:00.123456Z')
        self.runtime.command.return_value = json.dumps(dict(type='t', data=0))
        with self.assertRaises(ValueError):
            self.runtime.unit_state()

    def test_command_errors_never_expose_raw_stderr_or_exception(self):
        real = subject.PublicRuntime()
        for result in (subprocess.CompletedProcess([], 1, b'', b'private secret'), TimeoutError('private secret')):
            with patch.object(subject.subprocess, 'run', side_effect=result if isinstance(result, Exception) else None,
                    return_value=result):
                with self.assertRaisesRegex(ValueError, '^public_command_refused$'):
                    real.command(['/fixed'])

    def test_inspect_only_exact_container_and_preserves_full_profile(self):
        observed = dict(Id=subject.resume.CID, NetworkSettings=dict(Networks={'z': {}, 'a': {}}), private='unchanged')
        self.runtime.command.return_value = json.dumps([observed])
        result = self.runtime.inspect(subject.resume.CID)
        self.assertEqual(result['networks'], ['a', 'z'])
        self.assertEqual(result['private'], 'unchanged')
        with self.assertRaises(ValueError):
            self.runtime.inspect('foreign')

    def test_actual_renewed_unit_pin_is_exact_single_epoch_transition(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'prefunded-card'))
        import public_service_contract
        raw = public_service_contract.units()[subject.resume.SERVICE].encode()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '2d3dc4a04c38d35da211c9bb8d756b307c9b51faf3c284c5a67bb2c673e8903b')
        self.assertEqual(raw.count(b'1790697550'), 1)
        self.assertEqual(hashlib.sha256(raw.replace(b'1790697550', b'1791302350')).hexdigest(), subject.resume.UNIT_PIN)

    def test_actual_missing_environmentfiles_property_not_requested_or_fabricated(self):
        raw = dict(FragmentPath=subject.resume.UNIT, DropInPaths='', NeedDaemonReload='no', LoadState='loaded',
            Transient='no', Restart='no', ActiveState='inactive', SubState='dead', Result='success',
            ExecMainStatus='0', MainPID='0', InvocationID='', Environment='', PassEnvironment='', UnsetEnvironment='')
        self.runtime.unit_commands = Mock(return_value={field: [['/bin/sh', '-c', 'fixed']]
            for field in ('ExecCondition', 'ExecStart', 'ExecStopPost')})
        self.runtime.command.return_value = '\n'.join(name + '=' + value for name, value in raw.items())
        with patch.object(subject.resume, '_read', return_value=b'[Service]\nRestart=no\n'):
            result = self.runtime.unit_state()
        self.assertNotIn('EnvironmentFiles', result)
        self.assertNotIn('EnvironmentFiles', self.runtime.command.call_args.args[0][-1])

    def test_pinned_unit_environment_directive_or_effective_injection_refuses(self):
        for directive in ('Environment', 'EnvironmentFile', 'PassEnvironment', 'UnsetEnvironment'):
            with self.subTest(directive=directive), patch.object(subject.resume, '_read',
                    return_value=('[Service]\n' + directive + '=foreign\n').encode()):
                with self.assertRaises(ValueError):
                    self.runtime.unit_state()
        raw = dict(Environment='', PassEnvironment='', UnsetEnvironment='', DropInPaths='', NeedDaemonReload='no')
        self.runtime.properties = Mock()
        for field in raw:
            with self.subTest(field=field), patch.object(subject.resume, '_read', return_value=b'[Service]\n'):
                self.runtime.properties.return_value = dict(raw, **{field: 'foreign'})
                with self.assertRaises(ValueError):
                    self.runtime.unit_state()


if __name__ == '__main__':
    unittest.main()
