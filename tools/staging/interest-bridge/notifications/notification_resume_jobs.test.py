import copy
from datetime import timedelta
import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('notification_check_fixture', HERE/'notification_resume.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


def invoke(host):
    path = str(Path(__file__).resolve())
    host.files[path] = Path(path).read_bytes()
    host.reviewed['sources'][path] = FIXTURE.hashlib.sha256(host.files[path]).hexdigest()
    return host.invoke(True)


class Tests(unittest.TestCase):
    def test_terminal_start_does_not_confirm_pending_unknown_or_wrong_stop_job(self):
        for case in ('pending', 'unknown', 'wrong-id', 'lost-ack', 'stale-observation'):
            with self.subTest(case=case):
                host = FIXTURE.Host()
                original_job = host.job
                original_run = host.run
                def run(command, timeout):
                    if command[1] == 'stop' and case == 'lost-ack':
                        original_run(command, timeout)
                        raise TimeoutError('stop acknowledgement unavailable')
                    return original_run(command, timeout)
                def job(name, submitted, operation='start'):
                    value = original_job(name, submitted, operation)
                    if operation == 'stop':
                        if case == 'unknown':
                            raise ValueError('stop acknowledgement unavailable')
                        if case == 'pending':
                            value.update(terminal=False, pendingJobs=[value['jobId']])
                        elif case == 'wrong-id':
                            value['jobId'] = 1
                        elif case == 'stale-observation':
                            value['observedAt'] = (host.now-timedelta(seconds=1)).isoformat()
                    return value
                host.job, host.run = job, run
                result = invoke(host)
                self.assertEqual(result['status'], 'notification-resume-refused')
                self.assertTrue(result['startJobTerminal'])
                self.assertIsNone(result['checkStopped'])
                self.assertEqual(result['startJob']['jobId'], 1)
                self.assertEqual(len(result['stopJobs']), 2)
                self.assertEqual(result['stopJobs'][0]['jobId'], None if case == 'lost-ack' else 2)
                self.assertEqual(result['stopJobs'][1]['jobId'], None if case == 'lost-ack' else 3)

    def test_stop_timestamp_advances_and_does_not_reuse_start_submission(self):
        host = FIXTURE.Host()
        original_run = host.run
        def run(command, timeout):
            if command[1] == 'start':
                host.now += timedelta(seconds=2)
            result = original_run(command, timeout)
            if command[1] == 'stop':
                host.now += timedelta(seconds=2)
            return result
        def collect():
            value = copy.deepcopy(host.bundle)
            stamp = host.now.isoformat().replace('+00:00', 'Z')
            value['completed']['observedAt'] = value['protectedSnapshot']['capturedAt'] = stamp
            native = value['completed']['nativeEvidence']
            native['observedAt'] = native['receiptStorage']['observedAt'] = stamp
            native['provenance']['sourceProofObservedAt'] = stamp
            return value
        host.run, host.collect = run, collect
        result = invoke(host)
        self.assertEqual(result['status'], 'notification-readonly-check-verified')
        self.assertTrue(result['checkStopped'])
        self.assertTrue(result['startJobTerminal'])
        stop = result['stopJobs'][0]
        self.assertGreater(stop['submittedAt'], result['startJob']['submittedAt'])
        self.assertGreater(stop['observation']['observedAt'], stop['submittedAt'])
        self.assertTrue(stop['terminal'])


if __name__ == '__main__':
    unittest.main()
