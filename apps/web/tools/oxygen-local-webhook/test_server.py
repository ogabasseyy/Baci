import http.client
import importlib.util
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('relay', Path(__file__).with_name('server.py'))
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)

class RelayTests(unittest.TestCase):
    def setUp(self):
        self.server = relay.ThreadingHTTPServer(('127.0.0.1', 0), relay.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.client = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
    def tearDown(self):
        self.client.close()
        self.server.shutdown()
        self.server.server_close()
    def request(self, method, path, body=None, headers=None):
        self.client.request(method, path, body, headers or {})
        result = self.client.getresponse()
        return result.status, json.loads(result.read())
    def test_health_and_all_other_routes_are_closed(self):
        self.assertEqual(self.request('GET', '/health'), (200, {'ready': True, 'environment': 'staging'}))
        for path in ['/savings-synthetic/checkout', '/api/admin', '/api/payments/oxygen/webhook?x=1']:
            self.assertEqual(self.request('GET', path)[0], 404)
            self.assertEqual(self.request('POST', path, '{}')[0], 404)
    def test_body_limits_and_content_type_precede_forward(self):
        with patch.object(relay, 'forward') as forward:
            self.assertEqual(self.request('POST', relay.PATH, '{}', {'Content-Type': 'text/plain'})[0], 415)
            self.assertEqual(self.request('POST', relay.PATH, '', {'Content-Type': 'application/json'})[0], 413)
            self.assertEqual(self.request('POST', relay.PATH, '{}', {'Content-Type': 'application/json', 'Content-Length': '262145'})[0], 413)
            forward.assert_not_called()
    def test_only_authentication_headers_forward_without_cookies(self):
        with patch.object(relay, 'forward', return_value=(401, b'{"error":"Unauthorized"}')) as forward:
            status, _ = self.request('POST', relay.PATH, '{}', {'Content-Type': 'application/json', 'api_key': 'fixture', 'api_secret': 'fixture-secret', 'Cookie': 'never-forward', 'Host': 'untrusted.test'})
            self.assertEqual(status, 401)
            body, headers = forward.call_args.args
            self.assertEqual(body, b'{}')
            self.assertEqual(headers, {'Content-Type': 'application/json', 'api_key': 'fixture', 'api_secret': 'fixture-secret'})
    def test_upstream_failure_is_not_acknowledged(self):
        with patch.object(relay, 'forward', side_effect=TimeoutError):
            self.assertEqual(self.request('POST', relay.PATH, '{}', {'Content-Type': 'application/json'})[0], 503)

if __name__ == '__main__':
    unittest.main()
