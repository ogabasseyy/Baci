import http.server
import os
import pwd
import signal
import socketserver
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import cutover_runtime


class ProbeHandler(http.server.BaseHTTPRequestHandler):
    response_status = 401
    received_headers = {}

    def do_GET(self):
        type(self).received_headers = dict(self.headers)
        self.send_response(self.response_status)
        if self.response_status == 302:
            self.send_header('Location', '/redirect-target')
        self.end_headers()

    def log_message(self, format, *arguments):
        return


class ProbeTests(unittest.TestCase):
    def run_server(self, status):
        ProbeHandler.response_status = status
        server = socketserver.TCPServer(('127.0.0.1', 0), ProbeHandler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def test_unauthenticated_401_is_a_successful_loopback_smoke(self):
        port = self.run_server(401)

        self.assertTrue(cutover_runtime.probe(port))
        self.assertEqual(ProbeHandler.received_headers['Host'], 'staging.ogabassey.com')
        self.assertEqual(ProbeHandler.received_headers['X-Forwarded-Proto'], 'https')

    def test_redirect_is_not_accepted_as_an_unauthenticated_smoke(self):
        port = self.run_server(302)

        self.assertFalse(cutover_runtime.probe(port))


class LegacyStopTests(unittest.TestCase):
    def test_wrong_owner_never_sends_a_signal(self):
        listener = 'LISTEN 0 511 127.0.0.1:4792 0.0.0.0:* users:(("node",pid=4321,fd=21))'
        process = MagicMock()
        process.stat.return_value = SimpleNamespace(st_uid=1)
        with patch.object(cutover_runtime, 'command', return_value=listener), \
                patch.object(cutover_runtime.os, 'pidfd_open', return_value=99, create=True), \
                patch.object(cutover_runtime.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=-1)), \
                patch.object(cutover_runtime, 'Path', return_value=process), \
                patch.object(cutover_runtime.signal, 'pidfd_send_signal', create=True) as send_signal, \
                patch.object(cutover_runtime.os, 'close') as close:
            with self.assertRaisesRegex(RuntimeError, 'legacy-identity'):
                cutover_runtime.stop_legacy()

        send_signal.assert_not_called()
        close.assert_called_once_with(99)


class ActivationTests(unittest.TestCase):
    def install_fixture(self):
        return SimpleNamespace(
            UNIT_DIRECTORY=Path('/etc/systemd/system'),
            DESTINATION=Path('/opt/baci-savings-drafts'),
            require_root_and_time=lambda: None,
        )

    def test_timer_smoke_legacy_service_and_nginx_run_in_safe_order(self):
        installer = self.install_fixture()
        commands = []

        def run_command(arguments):
            commands.append(arguments)
            return ''

        with patch.object(cutover_runtime, 'command', side_effect=run_command), \
                patch.object(cutover_runtime, 'wait_ready') as wait_ready, \
                patch.object(cutover_runtime, 'stop_legacy') as stop_legacy:
            cutover_runtime.activate(installer, 'a' * 64)

        expected = [
            ['/usr/bin/systemd-analyze', 'verify',
             '/etc/systemd/system/baci-savings-drafts.service',
             '/etc/systemd/system/baci-savings-drafts-smoke.service',
             '/etc/systemd/system/baci-savings-drafts-deadline.timer',
             '/etc/systemd/system/baci-savings-drafts-deadline.service'],
            ['/usr/bin/systemctl', 'daemon-reload'],
            ['/usr/bin/systemctl', 'start', cutover_runtime.SMOKE],
            ['/usr/bin/systemctl', 'stop', cutover_runtime.SMOKE],
            ['/usr/bin/systemctl', 'enable', '--now', cutover_runtime.TIMER],
            ['/usr/bin/systemctl', 'is-active', '--quiet', cutover_runtime.TIMER],
            ['/usr/bin/systemctl', 'start', cutover_runtime.SERVICE],
            ['/usr/bin/python3', '-I',
             '/opt/baci-savings-drafts/installer/install-customer-draft-routes.py',
             '--install', '--expected-sha256', 'a' * 64],
        ]
        self.assertEqual(commands, expected)
        self.assertEqual(wait_ready.call_args_list, [call(cutover_runtime.SMOKE, 4794), call(cutover_runtime.SERVICE, 4792)])
        stop_legacy.assert_called_once_with()

    def test_health_failure_stops_new_service_without_invoking_nginx(self):
        installer = self.install_fixture()
        commands = []

        def run_command(arguments):
            commands.append(arguments)
            return ''

        with patch.object(cutover_runtime, 'command', side_effect=run_command), \
                patch.object(cutover_runtime, 'stop_legacy'), \
                patch.object(cutover_runtime, 'wait_ready', side_effect=[None, RuntimeError('service-health')]):
            with self.assertRaisesRegex(RuntimeError, 'service-health'):
                cutover_runtime.activate(installer, 'b' * 64)

        self.assertIn(['/usr/bin/systemctl', 'stop', cutover_runtime.SERVICE], commands)
        self.assertNotIn(['/usr/bin/python3', '-I',
                          '/opt/baci-savings-drafts/installer/install-customer-draft-routes.py',
                          '--install', '--expected-sha256', 'b' * 64], commands)


if __name__ == '__main__':
    unittest.main()
