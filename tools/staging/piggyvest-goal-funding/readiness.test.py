import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('piggyvest_readiness', Path(__file__).with_name('readiness.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ReadinessTests(unittest.TestCase):
    def test_preflight_checks_baseline_once_without_retrying(self):
        probe = unittest.mock.Mock(return_value=401)
        expectations = (('GET', '/wallet', 401),)
        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100):
            MODULE.verify(expectations, probe, 'preflight')
        probe.assert_called_once_with('GET', '/wallet', 2)

    def test_reload_wait_accepts_old_405_then_two_matching_samples(self):
        samples = iter([405, 401, 401])
        def probe(_method, _path, _timeout):
            return next(samples)

        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100), \
                patch.object(MODULE.time, 'sleep'):
            MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe, 'route-readiness', wait=True)

    def test_persistent_old_405_fails_at_eight_second_bound(self):
        clock = [0.0]

        def monotonic():
            return clock[0]

        def sleep(duration):
            clock[0] += duration

        with patch.object(MODULE.time, 'monotonic', side_effect=monotonic), \
                patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100), \
                patch.object(MODULE.time, 'sleep', side_effect=sleep):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),),
                              lambda _method, _path, _timeout: 405, 'route-readiness', wait=True)
        self.assertEqual(clock[0], MODULE.MAX_WAIT_SECONDS)
        self.assertEqual(failure.exception.report['checks'][0]['actual'], 405)
        self.assertTrue(failure.exception.report['deadlineReached'])

    def test_authentication_bypass_200_fails_immediately(self):
        probe = unittest.mock.Mock(return_value=200)
        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe, 'route-readiness', wait=True)
        probe.assert_called_once()
        self.assertEqual(failure.exception.report['checks'][0]['actual'], 200)

    def test_baseline_wallet_failure_stays_refused(self):
        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.verify((('GET', '/api/storefront/customer/wallet', 401),),
                              lambda _method, _path, _timeout: 200, 'preflight')
        self.assertEqual(failure.exception.report['checks'][0]['expected'], 401)

    def test_fixed_lease_expiry_refuses_before_probe(self):
        probe = unittest.mock.Mock(return_value=401)
        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY):
            with self.assertRaises(MODULE.ReadinessRefused):
                MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe,
                              'route-readiness', wait=True)
        probe.assert_not_called()

    def test_zero_deadline_budget_fails_without_probe_or_sleep(self):
        probe = unittest.mock.Mock(return_value=401)
        with patch.object(MODULE.time, 'time', return_value=100), \
                patch.object(MODULE.time, 'monotonic', return_value=10), \
                patch.object(MODULE.time, 'sleep') as sleep:
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe,
                              'route-readiness', wait=True, deadline_epoch=100)
        probe.assert_not_called()
        sleep.assert_not_called()
        self.assertTrue(failure.exception.report['deadlineReached'])

    def test_probe_timeout_never_exceeds_remaining_eight_second_budget(self):
        calls = []
        clock = [0.0]

        def probe(method, path, timeout):
            calls.append((timeout, MODULE.MAX_WAIT_SECONDS - clock[0]))
            clock[0] += timeout
            return 405

        def sleep(duration):
            clock[0] += duration

        with patch.object(MODULE.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100), \
                patch.object(MODULE.time, 'sleep', side_effect=sleep):
            with self.assertRaises(MODULE.ReadinessRefused):
                MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe,
                              'route-readiness', wait=True)
        self.assertTrue(all(timeout <= remaining for timeout, remaining in calls))
        self.assertEqual(clock[0], MODULE.MAX_WAIT_SECONDS)

    def test_probe_consuming_budget_refuses_even_when_it_returns_401(self):
        clock = [0.0]
        seen = []

        def probe(method, path, timeout):
            seen.append(timeout)
            clock[0] += timeout
            return 401

        with patch.object(MODULE.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 2):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe,
                              'route-readiness', wait=True)
        self.assertEqual(seen, [2])
        self.assertEqual(clock[0], 2)
        self.assertTrue(failure.exception.report['deadlineReached'])

    def test_second_matching_sample_is_required(self):
        calls = []
        clock = [0.0]

        def probe(method, path, timeout):
            calls.append((method, path, timeout))
            return 401

        def sleep(duration):
            clock[0] += duration

        with patch.object(MODULE.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100), \
                patch.object(MODULE.time, 'sleep', side_effect=sleep):
            MODULE.verify((('GET', MODULE.FUNDING_PATH, 401),), probe,
                          'route-readiness', wait=True)
        self.assertEqual(len(calls), 2)

    def test_direct_service_contract_expects_get_post_401_and_put_405(self):
        seen = []

        def probe(method, path, timeout):
            seen.append((method, path, timeout))
            return {'GET': 401, 'POST': 401, 'PUT': 405}[method]

        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100):
            MODULE.verify(MODULE.DIRECT_FUNDING_EXPECTATIONS, probe, 'funding-service-health')
        self.assertEqual([item[0] for item in seen], ['GET', 'POST', 'PUT'])
        self.assertTrue(all(item[1] == MODULE.FUNDING_PATH for item in seen))

    def test_failure_report_contains_only_safe_route_status_fields(self):
        with patch.object(MODULE.time, 'time', return_value=MODULE.LEASE_EXPIRY - 100):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.verify((('GET', '/safe', 401),),
                              lambda _method, _path, _timeout: None, 'preflight')
        self.assertEqual(set(failure.exception.report), {'phase', 'checks', 'deadlineReached'})
        self.assertEqual(failure.exception.report['checks'], [
            {'method': 'GET', 'path': '/safe', 'expected': 401, 'actual': None},
        ])


if __name__ == '__main__':
    unittest.main()
