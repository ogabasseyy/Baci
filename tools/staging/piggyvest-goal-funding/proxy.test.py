import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('proxy', Path(__file__).with_name('proxy.py'))
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.baseline = {'version': 3, 'routes': [
            {'src': '^/existing$', 'dest': 'https://staging-auth.ogabassey.com/existing'},
            {'src': '^' + proxy.PATH + '$', 'dest': 'https://staging-auth.ogabassey.com' + proxy.PATH, 'methods': ['POST']},
            {'src': '^' + proxy.PATH + '$', 'status': 405},
            {'handle': 'filesystem'},
        ]}

    def test_adds_get_only_without_mutating_other_routes_or_original(self):
        changed = proxy.extend(self.baseline)
        self.assertEqual(changed['routes'][1]['methods'], ['GET', 'POST'])
        self.assertEqual(self.baseline['routes'][1]['methods'], ['POST'])
        self.assertEqual(changed['routes'][:1], self.baseline['routes'][:1])
        self.assertEqual(changed['routes'][2:], self.baseline['routes'][2:])

    def test_refuses_foreign_origin_method_drift_or_missing_deny(self):
        for field, value in [('dest', 'https://ogabassey.com' + proxy.PATH), ('methods', ['GET'])]:
            original = self.baseline['routes'][1][field]
            self.baseline['routes'][1][field] = value
            with self.assertRaises(RuntimeError):
                proxy.extend(self.baseline)
            self.baseline['routes'][1][field] = original
        del self.baseline['routes'][2]
        with self.assertRaises(RuntimeError):
            proxy.extend(self.baseline)

    def test_refuses_missing_webhook_filesystem_fallthrough(self):
        self.baseline['routes'].pop()
        with self.assertRaises(RuntimeError):
            proxy.extend(self.baseline)

    def test_preserves_interleaved_existing_routes_before_funding_deny(self):
        other = {'src': '^/wallet$', 'dest': 'https://staging-auth.ogabassey.com/wallet'}
        self.baseline['routes'].insert(2, other)
        changed = proxy.extend(self.baseline)
        self.assertEqual(changed['routes'][2], other)
        self.assertEqual(changed['routes'][3], self.baseline['routes'][3])


if __name__ == '__main__':
    unittest.main()
