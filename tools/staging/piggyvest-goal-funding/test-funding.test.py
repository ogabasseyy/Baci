import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('funding', Path(__file__).with_name('test-funding.py'))
funding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(funding)


class FundingTests(unittest.TestCase):
    def test_never_repeats_an_accepted_or_ambiguous_funding(self):
        for phase in ('dispatched', 'accepted'):
            api = Mock()
            with self.assertRaises(RuntimeError):
                funding.dispatch(api, 'wallet', {'walletId': 'wallet', 'phase': phase}, Mock())
            api.assert_not_called()

    def test_persists_dispatch_before_sending_one_small_test_funding(self):
        states = []
        def api(method, path, body=None):
            if method == 'GET':
                return {'data': {'id': 'wallet', 'currency': 'NGN', 'balance': 0}}
            self.assertEqual(states, ['dispatched'])
            self.assertEqual(path, '/api/v1/transfer/test/funding')
            self.assertEqual(body, {'wallet_id': 'wallet', 'amount': 10000})
            return {'status': True}
        result = funding.dispatch(api, 'wallet', {'walletId': 'wallet', 'phase': 'prepared'}, lambda value: states.append(value['phase']))
        self.assertEqual(result['status'], 'accepted-not-settled')
        self.assertEqual(states, ['dispatched', 'accepted'])

    def test_refuses_nonempty_or_different_wallet_before_dispatch(self):
        for wallet in ({'id': 'other', 'currency': 'NGN', 'balance': 0}, {'id': 'wallet', 'currency': 'NGN', 'balance': 100}):
            api = Mock(return_value={'data': wallet})
            save = Mock()
            with self.assertRaises(RuntimeError):
                funding.dispatch(api, 'wallet', {'walletId': 'wallet', 'phase': 'prepared'}, save)
            save.assert_not_called()

    def test_timeout_leaves_dispatch_record_not_success(self):
        api = Mock(side_effect=[{'data': {'id': 'wallet', 'currency': 'NGN', 'balance': 0}}, TimeoutError()])
        save = Mock()
        with self.assertRaises(TimeoutError):
            funding.dispatch(api, 'wallet', {'walletId': 'wallet', 'phase': 'prepared'}, save)
        self.assertEqual(save.call_count, 1)
        self.assertEqual(save.call_args.args[0]['phase'], 'dispatched')


if __name__ == '__main__':
    unittest.main()
