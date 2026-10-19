import copy
import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('test_payment_proxy', Path(__file__).with_name('proxy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProxyTests(unittest.TestCase):
    def test_exact_post_routes_preserve_all_previous_routes_and_receiver(self):
        baseline = {'version': 3, 'routes': [{'src': '^/existing$', 'dest': 'https://staging-auth.ogabassey.com/existing'}, {'handle': 'filesystem'}]}
        original = copy.deepcopy(baseline)
        result = module.extend(baseline)
        self.assertEqual(baseline, original)
        self.assertEqual(result['routes'][0], baseline['routes'][0])
        self.assertEqual(result['routes'][-1], {'handle': 'filesystem'})
        for path in module.PATHS:
            rows = [row for row in result['routes'] if row.get('src') == '^' + path + '$']
            self.assertEqual(rows, [{'src': '^' + path + '$', 'dest': 'https://staging-auth.ogabassey.com' + path, 'methods': ['POST']}, {'src': '^' + path + '$', 'status': 405}])

    def test_refuses_existing_target_or_unrecognized_fallthrough(self):
        for baseline in (
            {'version': 3, 'routes': [{'handle': 'filesystem'}, {'src': '.*'}]},
            {'version': 3, 'routes': [{'src': '^' + module.PATHS[0] + '$'}, {'handle': 'filesystem'}]},
            {'version': 2, 'routes': [{'handle': 'filesystem'}]},
        ):
            with self.assertRaises(RuntimeError):
                module.extend(baseline)


if __name__ == '__main__':
    unittest.main()
