import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('engagement_nginx', Path(__file__).with_name('nginx.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
BASELINE = b'''server {
listen 443 ssl;
server_name staging-auth.ogabassey.com;
location /auth/v1/ { proxy_pass http://127.0.0.1:9999/; }
location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }
location / { return 404; }
}
'''


class NginxTests(unittest.TestCase):
    def test_reload_waits_for_new_workers_instead_of_rolling_back_on_first_404(self):
        helper = Mock()
        rendered = self.render()
        helper.read_target.return_value = (BASELINE, object())
        helper.make_backup.return_value = Path('/root/backup')
        probes = [401, 401, 401, 404, 404, 404, 404]
        probes += [404, 404, 404, 401, 401, 401, 404]
        probes += [401, 401, 405, 401, 401, 401, 404] * 2
        with patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE, 'helpers', return_value=helper), patch.object(MODULE, 'probe', side_effect=probes), patch('time.sleep'):
            result = MODULE.install(hashlib.sha256(BASELINE).hexdigest())
        self.assertEqual(result['status'], 'active')
        helper.atomic_write.assert_called_once()
        self.assertEqual(helper.atomic_write.call_args.args[0], rendered)

    def test_persistent_probe_failure_restores_and_verifies_original_routes(self):
        helper = Mock()
        helper.read_target.side_effect = [(BASELINE, object()), (self.render(), object())]
        helper.make_backup.return_value = Path('/root/backup')

        def probe(method, route, **options):
            return 404 if route in (MODULE.NOTIFICATIONS.decode(), '/piggyvest/intake') else 401

        with patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE, 'helpers', return_value=helper), patch.object(MODULE, 'probe', side_effect=probe), patch('time.sleep'):
            with self.assertRaises(RuntimeError) as failure:
                MODULE.install(hashlib.sha256(BASELINE).hexdigest())
        self.assertEqual(failure.exception.report['phase'], 'route-readiness')
        self.assertEqual(failure.exception.report['rollback'], 'verified')
        self.assertEqual(helper.atomic_write.call_args.args[0], BASELINE)
        self.assertEqual(helper.validate_reload.call_count, 2)

    def test_stalled_probe_uses_remaining_wall_clock_budget_and_stops_polling(self):
        clock = [0.0]

        def stalled(method, route, timeout):
            clock[0] += timeout + 0.1
            raise MODULE.subprocess.TimeoutExpired('redacted', timeout)

        with patch.object(MODULE, 'probe', side_effect=stalled) as probe, patch('time.monotonic', side_effect=lambda: clock[0]), patch('time.sleep'):
            with self.assertRaises(RuntimeError) as failure:
                MODULE.wait_for_routes([('GET', '/safe', 401)] * 7)
        self.assertLessEqual(probe.call_count, 4)
        self.assertLessEqual(clock[0], 8.2)
        self.assertTrue(failure.exception.report['deadlineReached'])

    def render(self, content=BASELINE):
        return MODULE.render(content, hashlib.sha256(content).hexdigest())

    def test_adds_only_exact_notification_route_and_preserves_existing_content(self):
        actual = self.render()
        self.assertEqual(actual.replace(MODULE.LOCATION, b''), BASELINE)
        self.assertIn(b'if ($request_method !~ ^(GET|PATCH)$)', actual)
        self.assertIn(b'proxy_pass http://127.0.0.1:4795;', actual)
        self.assertIn(b'proxy_set_header Host staging.ogabassey.com;', actual)
        self.assertIn(b'proxy_set_header Forwarded "";', actual)
        self.assertIn(b'access_log off;', actual)

    def test_refuses_hash_drift(self):
        with self.assertRaises(RuntimeError):
            MODULE.render(BASELINE, '0' * 64)

    def test_refuses_foreign_host_multiple_servers_or_duplicate_path(self):
        for content in (
            BASELINE.replace(b'staging-auth.ogabassey.com', b'ogabassey.com'),
            BASELINE + BASELINE,
            BASELINE.replace(b'location / {', b'location = ' + MODULE.NOTIFICATIONS + b' {'),
            BASELINE.replace(b'listen 443 ssl;', b'listen 443 ssl; include /other.conf;'),
        ):
            with self.subTest(content=content), self.assertRaises(RuntimeError):
                self.render(content)

    def test_refuses_malformed_blocks(self):
        with self.assertRaises(RuntimeError):
            self.render(BASELINE[:-2])

    def test_accepts_identical_installed_location_without_duplication(self):
        installed = self.render()
        self.assertEqual(self.render(installed), installed)


if __name__ == '__main__':
    unittest.main()
