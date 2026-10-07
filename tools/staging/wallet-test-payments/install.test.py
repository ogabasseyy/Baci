import hashlib
import importlib.util
import errno
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wallet_test_install', Path(__file__).with_name('install.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

BASELINE = b'''server {
    listen 443 ssl;
    server_name staging-auth.ogabassey.com;
    location / { return 404; }
}
'''


class InstallTests(unittest.TestCase):
    def test_renders_only_the_three_exact_post_routes(self):
        rendered = MODULE.render_nginx(BASELINE, hashlib.sha256(BASELINE).hexdigest())
        for route, port in MODULE.ROUTES:
            self.assertIn(f'location = {route}'.encode(), rendered)
            self.assertIn(f'proxy_pass http://127.0.0.1:{port};'.encode(), rendered)
        self.assertEqual(rendered.count(b'if ($request_method != POST)'), 3)
        self.assertIn(b'Forwarded ""', rendered)
        self.assertEqual(rendered.count(b'client_max_body_size 16k;'), 3)
        self.assertIn(b'proxy_set_header x-middleware-subrequest "";', rendered)
        self.assertIn(b'add_header Cache-Control "no-store" always;', rendered)

    def test_refuses_nginx_hash_drift_or_existing_test_route(self):
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.render_nginx(BASELINE, '0' * 64)
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.render_nginx(BASELINE.replace(b'location / {', b'location = /api/storefront/customer/wallet/top-up/initialize {'), hashlib.sha256(BASELINE.replace(b'location / {', b'location = /api/storefront/customer/wallet/top-up/initialize {')).hexdigest())

    def test_public_config_requires_fixed_staging_endpoints_and_approved_ids(self):
        valid = {
            'authOrigin': 'https://staging-auth.ogabassey.com',
            'apiOrigin': 'https://staging.ogabassey.com',
            'anonKey': 'public',
            'merchantId': '10000000-0000-4000-8000-000000000001',
            'customerIds': ['10000000-0000-4000-8000-000000000002'],
        }
        MODULE.derive_runtime_config.__globals__['validate_public_config'](valid)
        invalid = {**valid, 'apiOrigin': 'https://ogabassey.com'}
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.derive_runtime_config.__globals__['validate_public_config'](invalid)

    def test_unit_uses_load_credentials_and_strict_nonprivileged_service(self):
        unit = MODULE.render_unit().decode()
        self.assertIn('User=baci-staging-test-payments', unit)
        self.assertIn('LoadCredential=paystack-secret:/etc/baci/staging-test-payments/paystack-secret', unit)
        self.assertIn('LoadCredential=database-password:/etc/baci/staging-test-payments/database-password', unit)
        self.assertIn('LoadCredential=config:/etc/baci/staging-test-payments/config.json', unit)
        self.assertIn('LoadCredential=postgres-ca:/etc/baci/piggyvest-staging/postgres-ca.pem', unit)
        self.assertIn('NoNewPrivileges=yes', unit)
        self.assertIn('CapabilityBoundingSet=\n', unit)
        self.assertIn('ExecCondition=', unit)
        self.assertIn('ExecStartPre=/usr/bin/node /opt/baci-staging-test-payments/server.cjs --check', unit)
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', unit)
        self.assertNotIn('MemoryDenyWriteExecute', unit)
        self.assertIn('ExecStart=/usr/bin/node /opt/baci-staging-test-payments/server.cjs', unit)

    def test_credential_normalizes_a_single_file_terminator_without_accepting_whitespace(self):
        with patch.object(MODULE, 'read_root_file', return_value=b'sk_test_fixture\n'), patch.object(MODULE, 'write_secret') as write:
            MODULE.credential(MODULE.PAYSTACK_SECRET, 'sk_test_', MODULE.PAYSTACK_SECRET, 'unused')
        write.assert_called_once_with(MODULE.PAYSTACK_SECRET, 'sk_test_fixture')

    def test_credential_refuses_to_prompt_without_a_controlling_terminal(self):
        with patch.object(MODULE.os, 'open', side_effect=OSError(errno.ENXIO, 'no tty')), patch.object(MODULE.getpass, 'getpass') as prompt:
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.credential(MODULE.PAYSTACK_SECRET, 'sk_test_', None, 'unused')
        prompt.assert_not_called()

    def test_existing_credential_never_requires_a_controlling_terminal(self):
        with patch.object(MODULE, 'read_root_file', return_value=b'sk_test_fixture'), patch.object(MODULE, 'write_secret'), patch.object(MODULE.os, 'open') as open_tty:
            MODULE.credential(MODULE.PAYSTACK_SECRET, 'sk_test_', MODULE.PAYSTACK_SECRET, 'unused')
        open_tty.assert_not_called()

    def test_credential_refuses_getpass_fallback_warning(self):
        with patch.object(MODULE.os, 'open', return_value=7), patch.object(MODULE.os, 'close'), patch.object(MODULE.getpass, 'getpass', side_effect=MODULE.getpass.GetPassWarning('echo fallback')):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.credential(MODULE.PAYSTACK_SECRET, 'sk_test_', None, 'unused')

    def test_gateway_uses_only_the_sealed_bundle_entrypoint(self):
        bundle = Path('/root/baci-test-payments')
        with patch.object(MODULE.subprocess, 'run') as run:
            MODULE.gateway(bundle, '--check')
        self.assertEqual(run.call_args.args[0], ['/usr/bin/python3', '/root/baci-test-payments/gateway.py', '--check'])
        self.assertEqual(run.call_args.kwargs['timeout'], 90)

    def test_deadline_timer_is_checked_before_gateway_can_expose_new_routes(self):
        with patch.object(MODULE, 'timer_is_active', return_value=False), patch.object(MODULE, 'gateway') as gateway:
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.apply_gateway_after_timer(Path('/root/bundle'), 'a' * 64, b'server', 'b' * 64)
        gateway.assert_not_called()

    def test_readiness_requires_three_401s_and_uses_bounded_retries(self):
        expected = [('POST', '/one', 401), ('GET', '/two', 401), ('POST', '/three', 401)]
        with patch.object(MODULE, 'probe', side_effect=[401, 401, 404, 401, 401, 401, 401, 401, 401]) as probe, patch.object(MODULE.time, 'sleep'):
            MODULE.wait_for_routes(expected)
        self.assertEqual(probe.call_count, 9)

    def test_readiness_respects_one_shared_eight_second_budget_when_probes_stall(self):
        clock = [0.0]

        def stalled_probe(_port, _route, timeout):
            clock[0] += timeout + 0.1
            return None

        with (
            patch.object(MODULE.time, 'monotonic', side_effect=lambda: clock[0]),
            patch.object(MODULE, 'probe', side_effect=stalled_probe) as probe,
            patch.object(MODULE.time, 'sleep'),
        ):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.wait_for_routes([('POST', '/one', 401), ('GET', '/two', 401), ('POST', '/three', 401)])
        self.assertLessEqual(probe.call_count, 4)
        self.assertLessEqual(clock[0], 8.2)

if __name__ == '__main__':
    unittest.main()
