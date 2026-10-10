import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('engagement_proxy', Path(__file__).with_name('proxy.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ProxyTests(unittest.TestCase):
    def test_failed_download_does_not_leave_a_directory_that_blocks_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'candidate'
            with patch.object(MODULE, 'download', side_effect=RuntimeError('offline')):
                with self.assertRaises(RuntimeError):
                    MODULE.prepare(target)
            self.assertFalse(target.exists())

    def test_preserves_every_existing_route_and_receiver_fallthrough(self):
        baseline = {'version': 3, 'routes': [
            {'src': '^/api/storefront/customer/wallet$', 'methods': ['GET'],
             'dest': 'https://staging-auth.ogabassey.com/api/storefront/customer/wallet'},
            {'src': '^/api/storefront/customer/wallet$', 'status': 405},
            {'handle': 'filesystem'},
        ]}
        result = MODULE.extend(baseline)
        self.assertEqual(result['routes'][:2], baseline['routes'][:2])
        self.assertEqual(result['routes'][-1], {'handle': 'filesystem'})
        self.assertEqual(result['routes'][-3], {
            'src': '^/api/storefront/customer/savings/notifications$',
            'dest': 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/notifications',
            'methods': ['GET', 'PATCH'],
        })
        self.assertEqual(result['routes'][-2]['status'], 405)
        self.assertEqual(len(baseline['routes']), 3)

    def test_refuses_duplicate_missing_fallthrough_or_wrong_version(self):
        for baseline in (
            {'version': 2, 'routes': [{'handle': 'filesystem'}]},
            {'version': 3, 'routes': []},
            {'version': 3, 'routes': [{'src': '^/api/storefront/customer/savings/notifications$'}, {'handle': 'filesystem'}]},
        ):
            with self.subTest(baseline=baseline), self.assertRaises(RuntimeError):
                MODULE.extend(baseline)


if __name__ == '__main__':
    unittest.main()
