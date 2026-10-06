from datetime import datetime, timezone
import json
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import public_resume_runtime as subject
import public_resume_bootstrap as bootstrap


NOW = datetime(2026, 10, 3, 20, tzinfo=timezone.utc)


def jobs(identifier=None, unit=subject.resume.SERVICE):
    rows = [] if identifier is None else [[identifier, unit, 'start', 'waiting',
        '/org/freedesktop/systemd1/job/' + str(identifier), '/unit']]
    return json.dumps(dict(type='a(usssoo)', data=[rows]))


class Tests(unittest.TestCase):
    def runtime(self, identifier=47):
        runtime = subject.PublicRuntime()
        runtime.job, runtime.submitted, runtime.attempted = identifier, NOW, True
        runtime.clock = Mock(return_value=NOW)
        runtime.stop_authority = Mock(return_value=True)
        return runtime

    def test_queued_owned_start_cancelled_and_unit_stopped_before_docker_stop(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(47), '',
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])),
            jobs(), 'ActiveState=inactive\nMainPID=0\n', '', jobs(), 'ActiveState=inactive\nMainPID=0\n',
            jobs(), 'ActiveState=inactive\nMainPID=0\n'])
        runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        calls = [call.args[0] for call in runtime.command.call_args_list]
        self.assertEqual(calls[1][-3:], ['CancelJob', 'u', '47'])
        self.assertEqual(calls[2][-4:], ['StopUnit', 'ss', subject.resume.SERVICE, 'replace'])
        self.assertEqual(calls[5], [*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID])
        self.assertTrue(runtime.start_job_state(subject.resume.SERVICE, NOW)['terminal'])

    def test_unknown_start_identity_still_stops_exact_unit_without_cancelling_foreign_id(self):
        runtime = self.runtime(None)
        runtime.command = Mock(side_effect=[jobs(99),
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])),
            jobs(), 'ActiveState=failed\nMainPID=0\n', '', jobs(), 'ActiveState=failed\nMainPID=0\n'])
        runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertFalse(any('CancelJob' in call.args[0] for call in runtime.command.call_args_list))
        with self.assertRaises(ValueError):
            runtime.start_job_state(subject.resume.SERVICE, NOW)

    def test_already_activating_unit_must_reach_stopped_state_before_docker_stop(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(),
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])),
            jobs(), 'ActiveState=activating\nMainPID=42\n',
            jobs(), 'ActiveState=inactive\nMainPID=0\n', '', jobs(), 'ActiveState=inactive\nMainPID=0\n'])
        with patch.object(subject.time, 'sleep'):
            runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertTrue(runtime.cleanup_confirmed)
        self.assertEqual(runtime.command.call_args_list[-3].args[0],
            [*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID])

    def test_failed_cancellation_docker_stop_cannot_claim_terminal_cleanup_or_retry(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(47), TimeoutError('private'), TimeoutError('stop timeout'), '',
            jobs(), 'ActiveState=inactive\nMainPID=0\n'])
        with self.assertRaises(TimeoutError):
            runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertFalse(runtime.start_job_state(subject.resume.SERVICE, NOW)['terminal'])
        with self.assertRaises(ValueError):
            runtime.run(['/usr/bin/systemctl', 'start', subject.resume.SERVICE], timeout=30)

    def test_cancel_timeout_still_submits_and_settles_exact_stopunit(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(47), TimeoutError('private'),
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])),
            jobs(), 'ActiveState=inactive\nMainPID=0\n', '', jobs(), 'ActiveState=inactive\nMainPID=0\n'])
        runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertTrue(runtime.cleanup_confirmed)
        self.assertEqual(runtime.command.call_args_list[2].args[0][-4:],
            ['StopUnit', 'ss', subject.resume.SERVICE, 'replace'])

    def test_cleanup_uses_one_overall_fifteen_second_budget(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(),
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])), jobs(),
            'ActiveState=inactive\nMainPID=0\n', '', jobs(), 'ActiveState=inactive\nMainPID=0\n'])
        with patch.object(subject.time, 'monotonic', side_effect=[0, 1, 2, 3, 4, 12, 13, 14, 16]):
            with self.assertRaises(ValueError):
                runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertFalse(runtime.cleanup_confirmed)
        self.assertEqual(runtime.command.call_args_list[4].args[1], 3)

    def test_slow_settlement_expires_before_reserved_docker_stop_budget(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(),
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])), jobs(),
            'ActiveState=activating\nMainPID=42\n', ''])
        with patch.object(subject.time, 'monotonic', side_effect=[0, 1, 2, 3, 8.5, 9.1, 9.2]):
            with self.assertRaises(ValueError):
                runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertEqual(runtime.command.call_args.args[0],
            [*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID])
        self.assertGreater(runtime.command.call_args.args[1], 5)
        self.assertLessEqual(runtime.command.call_args_list[0].args[1], 1)
        self.assertLessEqual(runtime.command.call_args_list[1].args[1], 3)
        self.assertLessEqual(runtime.command.call_args_list[2].args[1], 1)
        self.assertFalse(runtime.cleanup_confirmed)

    def test_foreign_job_identity_never_cancelled_but_fixed_stopunit_still_attempted(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=[jobs(47, 'foreign.service'),
            json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])), jobs(),
            'ActiveState=inactive\nMainPID=0\n', '', jobs(), 'ActiveState=inactive\nMainPID=0\n'])
        runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        self.assertTrue(runtime.cleanup_confirmed)
        self.assertFalse(any('CancelJob' in call.args[0] for call in runtime.command.call_args_list))
        self.assertEqual(runtime.command.call_args_list[1].args[0][-4:],
            ['StopUnit', 'ss', subject.resume.SERVICE, 'replace'])

    def cleanup_outputs(self, failure=None):
        outputs = [jobs(47), '', json.dumps(dict(type='o', data=['/org/freedesktop/systemd1/job/48'])),
            jobs(), 'ActiveState=inactive\nMainPID=0\n', '', jobs(), 'ActiveState=inactive\nMainPID=0\n',
            jobs(), 'ActiveState=inactive\nMainPID=0\n']
        return outputs if failure is None else [failure, *outputs[2:]]

    def test_bootstrap_late_refusal_uses_shared_cancel_settle_stop_primitive(self):
        runtime = self.runtime()
        runtime.command = Mock(side_effect=self.cleanup_outputs(TimeoutError('initial ListJobs timeout')))
        runtime.inspect = Mock(return_value=dict(Id=subject.resume.CID, Name='/' + subject.resume.NAME,
            Image=subject.resume.IMAGE, State={'Running': False}))
        result = bootstrap.late_refusal(runtime, {'status': 'public-service-resumed'}, subject.resume)
        self.assertTrue(result['ownedContainerStopped'])
        self.assertFalse(any('CancelJob' in call.args[0] for call in runtime.command.call_args_list))
        self.assertEqual(runtime.command.call_args_list[1].args[0][-4:],
            ['StopUnit', 'ss', subject.resume.SERVICE, 'replace'])

    def test_public_resume_refusal_uses_shared_cancel_settle_stop_primitive(self):
        here = Path(__file__).resolve().parent
        spec = importlib.util.spec_from_file_location('cleanup_resume_fixture', here / 'public_resume.test.py')
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        host = fixture.Host()
        runtime = self.runtime()
        runtime.submitted = host.now
        runtime.clock = Mock(return_value=host.now)
        runtime.command = Mock(side_effect=self.cleanup_outputs(ValueError('initial ListJobs failure')))
        def run(arguments, timeout):
            if arguments == ['/usr/bin/systemctl', 'start', subject.resume.SERVICE]:
                raise TimeoutError('queued start')
            return runtime.run(arguments, timeout=timeout)
        host.run, host.start_job_state = run, runtime.start_job_state
        for path in (Path(__file__).resolve(), Path(subject.__file__).resolve()):
            raw = path.read_bytes()
            host.files[str(path)] = raw
            host.authority['sources'][str(path)] = hashlib.sha256(raw).hexdigest()
        with patch.multiple(fixture.MODULE, MANIFEST_PIN=fixture.digest(host.files[host.manifest_path]),
                UNIT_PIN=fixture.digest(host.files[fixture.UNIT])):
            result = host.resume()
        self.assertTrue(result['startAttempted'])
        self.assertTrue(result['ownedContainerStopped'])
        self.assertFalse(any('CancelJob' in call.args[0] for call in runtime.command.call_args_list))
        self.assertEqual(runtime.command.call_args_list[1].args[0][-4:],
            ['StopUnit', 'ss', subject.resume.SERVICE, 'replace'])


if __name__ == '__main__':
    unittest.main()
