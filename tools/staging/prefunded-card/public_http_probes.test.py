import unittest
from unittest.mock import patch

import public_http_probes as probes


class ProbeTests(unittest.TestCase):
    def test_baseline_checks_only_known_unauthenticated_routes(self):
        calls = []
        def request(method, path):
            calls.append((method, path))
            return (405, 'text/html', b'') if path == '/piggyvest/intake' else (401, 'application/json', b'{"error":"unauthorized"}')
        with patch.object(probes, 'request', side_effect=request):
            self.assertTrue(probes.baseline())
        self.assertEqual(len(calls), 5)
        self.assertEqual({method for method, _ in calls}, {'GET'})

    def test_baseline_refuses_a_json_looking_html_success_or_redirect(self):
        for status, kind, body in [(200, 'application/json', b'{}'), (302, 'text/html', b''), (401, 'text/html', b'{}'), (401, 'application/json', b'not-json')]:
            with patch.object(probes, 'request', return_value=(status, kind, body)):
                with self.assertRaises(probes.Refused):
                    probes.baseline()

    def test_public_checks_auth_methods_saved_card_denial_and_callback_assets(self):
        paths = []
        def request(method, path):
            paths.append((method, path))
            if path.startswith('/savings/card-assets/'):
                return 200, 'application/javascript', b'asset'
            if path == '/savings/card-return':
                return 200, 'text/html', b'<script src="/savings/card-assets/_next/static/chunks/page-a.js"></script>'
            if path == '/api/csrf' and method == 'GET':
                return 200, 'application/json', b'{"token":"synthetic"}'
            if path.endswith('card-contributions'):
                return 404, 'text/html', b''
            if method == 'PUT' or path == '/api/csrf':
                return 405, 'text/html', b''
            return 401, 'application/json', b'{"error":"unauthorized"}'
        with patch.object(probes, 'request', side_effect=request):
            self.assertTrue(probes.public_routes())
        self.assertIn(('GET', '/savings/card-assets/_next/static/chunks/page-a.js'), paths)
        self.assertIn(('POST', '/api/storefront/customer/savings/card-checkout'), paths)

    def test_missing_or_escaped_assets_are_never_followed(self):
        for document in (b'<html/>', b'<script src="/savings/card-assets/_next/static/../secret"></script>', b'<script src="https://foreign.invalid/code.js"></script>'):
            with self.assertRaises(probes.Refused):
                probes.asset_paths(document)


if __name__ == '__main__':
    unittest.main()
