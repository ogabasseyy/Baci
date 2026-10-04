import unittest
from unittest.mock import Mock, patch

from cutover_preflight import preflight
from cutover_database import BODY
from cutover_runtime import NATIVE_ID


class PreflightTests(unittest.TestCase):
    def test_preflight_does_not_start_stop_or_mutate_any_worker(self):
        context = Mock()
        context.operator.find.return_value = NATIVE_ID
        context.operator.inspect.return_value = {'State': {'Running': True}}
        context.competitor.return_value = {'State': {'Running': False}}
        context.credentials.return_value = ({}, {})
        snapshot = dict(identity=dict(systemIdentifier='7686901100561231906'), routine=dict(bodySha256=BODY))
        with patch('cutover_preflight._credentials'), patch('cutover_preflight.capture_snapshot', return_value=snapshot):
            result = preflight(context)
        self.assertFalse(result['fenceApplied'])
        self.assertFalse(result['newPaymentStarted'])
        context.operator.start_bounded.assert_not_called()
        context.operator.run.assert_not_called()
        context.execute.assert_not_called()

    def test_preflight_refuses_if_natural_retry_worker_stopped(self):
        context = Mock()
        context.operator.find.return_value = NATIVE_ID
        context.operator.inspect.return_value = {'State': {'Running': False}}
        with self.assertRaisesRegex(ValueError, 'natural_native_retry_must_remain_running'):
            preflight(context)
        context.execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
