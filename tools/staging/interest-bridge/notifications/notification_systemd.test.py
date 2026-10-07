from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock


HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1]/'replay-complete-cutover-owner')]
SPEC = importlib.util.spec_from_file_location('notification_systemd', HERE/'notification_systemd.py')
SUBJECT = importlib.util.module_from_spec(SPEC)
if Path(SPEC.origin).exists():
    SPEC.loader.exec_module(SUBJECT)


class Tests(unittest.TestCase):
    def test_structured_exec_preserves_shell_script_and_repeated_commands(self):
        script = 'test "$(/bin/date -u +%s)" -lt "1791302350"'
        host = self.host()
        import json
        host.command.return_value = json.dumps(dict(type='a(sasbttttuii)',
            data=[['/bin/sh', ['/bin/sh', '-c', script], False, 0, 0, 0, 0, 0, 0, 0]]))
        self.assertEqual(host.exec_commands('/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2eservice', 'ExecCondition'),
            [['/bin/sh', '-c', script]])
        host.command.return_value = json.dumps(dict(type='a(sasbttttuii)', data=[
            ['/usr/bin/systemctl', ['/usr/bin/systemctl', 'stop', 'fixed.service'], False, 0, 0, 0, 0, 0, 0, 0],
            ['/usr/bin/docker', ['/usr/bin/docker', 'stop', 'fixed'], False, 0, 0, 0, 0, 0, 0, 0]]))
        self.assertEqual(len(host.exec_commands('/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2ddeadline_2eservice', 'ExecStart')), 2)

    def host(self):
        host = SUBJECT.NotificationSystemd.__new__(SUBJECT.NotificationSystemd)
        host.job, host.submitted, host.attempted = None, None, False
        host.clock = Mock(return_value=datetime(2026, 10, 3, 20, tzinfo=timezone.utc))
        host.exclusive = Mock(return_value=True)
        host.command = Mock(return_value='{"type":"o","data":["/org/freedesktop/systemd1/job/71"]}')
        host.jobs = Mock(return_value=[])
        host.state = Mock(return_value=dict(ActiveState='inactive', pendingJobs=[], MainPID='0'))
        host.cleanup_state = host.state
        host.owned_lock = Mock(return_value=True)
        host.stop_authority = Mock(return_value=True)
        return host

    def test_cleanup_after_seal_failure_uses_replace_and_actual_terminal_proof(self):
        host = self.host()
        host.attempted = True
        host.exclusive.side_effect = ValueError('seal drift')
        host.run([SUBJECT.BASE.SYSTEMCTL, 'stop', SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE], timeout=30)
        self.assertTrue(host.cleanup_confirmed)
        self.assertTrue(all(call.args[0][-1] == 'replace' for call in host.command.call_args_list))
        host.exclusive.assert_not_called()

    def test_failed_first_stop_still_attempts_second_and_retains_uncertainty(self):
        host = self.host()
        host.attempted = True
        host.command.side_effect = [TimeoutError(), '{"type":"o","data":["/org/freedesktop/systemd1/job/72"]}']
        host.state.return_value['ActiveState'] = 'active'
        with self.assertRaises(ValueError):
            host.run([SUBJECT.BASE.SYSTEMCTL, 'stop', SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE], timeout=30)
        self.assertEqual(host.command.call_count, 2)
        self.assertFalse(host.cleanup_confirmed)

    def test_loadunit_requires_exact_encoded_path(self):
        host = self.host()
        host.command.return_value = '{"type":"o","data":["/org/freedesktop/systemd1/unit/foreign"]}'
        with self.assertRaises(ValueError):
            host.object_path(SUBJECT.BASE.TIMER)
        self.assertIn('LoadUnit', host.command.call_args.args[0])

    def test_arbitrary_exec_path_is_refused_before_command(self):
        host = self.host()
        with self.assertRaises(ValueError):
            host.exec_commands('/org/freedesktop/systemd1/unit/foreign', 'ExecStart')
        host.command.assert_not_called()

    def test_unowned_stop_is_refused_without_command(self):
        host = self.host()
        with self.assertRaises(ValueError):
            host.run([SUBJECT.BASE.SYSTEMCTL, 'stop', SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE], timeout=30)
        host.command.assert_not_called()

    def test_lost_stop_ack_requires_actual_stopped_state_not_ack(self):
        host = self.host()
        host.attempted = True
        host.command.side_effect = TimeoutError()
        host.run([SUBJECT.BASE.SYSTEMCTL, 'stop', SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE], timeout=30)
        self.assertTrue(host.cleanup_confirmed)
        self.assertEqual(host.command.call_count, 2)

    def test_terminal_cleanup_never_reads_active_timer_schedule(self):
        host = self.host()
        host.properties = Mock(return_value=dict(Id=SUBJECT.BASE.TIMER, ActiveState='inactive'))
        value = SUBJECT.NotificationSystemd.cleanup_state(host, SUBJECT.BASE.TIMER, lambda limit: limit)
        self.assertEqual(value['MainPID'], '0')
        host.state.assert_not_called()
        self.assertEqual(host.properties.call_args.args[1], ['Id', 'ActiveState'])

    def test_stopped_but_unpinned_replacement_unit_never_confirms_owned_cleanup(self):
        host = self.host()
        host.attempted = True
        host.stop_authority.return_value = False
        with self.assertRaises(ValueError):
            host.run([SUBJECT.BASE.SYSTEMCTL, 'stop', SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE], timeout=30)
        self.assertFalse(host.cleanup_confirmed)
        host.command.assert_not_called()

    def test_only_fixed_timer_start_and_owned_stop_are_exposed(self):
        host = self.host()
        host.run(['/usr/bin/systemctl', 'start', SUBJECT.BASE.TIMER], timeout=30)
        self.assertEqual(host.job, 71)
        self.assertIn('StartUnit', host.command.call_args.args[0])
        self.assertNotIn(SUBJECT.BASE.SERVICE, host.command.call_args.args[0])
        with self.assertRaises(ValueError):
            host.run(['/usr/bin/systemctl', 'start', SUBJECT.BASE.SERVICE], timeout=30)
        with self.assertRaises(ValueError):
            host.run(['/usr/bin/systemctl', 'enable', SUBJECT.BASE.TIMER], timeout=30)

    def test_lost_start_ack_is_unconfirmed_not_fabricated_job(self):
        host = self.host()
        host.command.side_effect = TimeoutError('private output')
        with self.assertRaises(TimeoutError):
            host.run(['/usr/bin/systemctl', 'start', SUBJECT.BASE.TIMER], timeout=30)
        self.assertTrue(host.attempted)
        self.assertIsNone(host.job)
        with self.assertRaises(ValueError):
            host.job_state(SUBJECT.BASE.TIMER, host.clock().isoformat())

    def test_cleanup_calls_only_two_owned_units_and_confirms_their_jobs(self):
        host = self.host()
        host.attempted = True
        host.run(['/usr/bin/systemctl', 'stop', SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE], timeout=30)
        arguments = [call.args[0] for call in host.command.call_args_list]
        self.assertEqual([value[-2] for value in arguments], [SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE])


if __name__ == '__main__':
    unittest.main()
