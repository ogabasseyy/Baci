import hashlib
import importlib.util
import unittest
from pathlib import Path


HERE = Path(__file__).parent


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


funding = load_module('funding_route_fixture', 'install-customer-funding-routes.py')
drafts = load_module('draft_route_fixture', 'install-customer-draft-routes.py')
intake = load_module('intake_route_fixture', 'install-intake-route.py')
routes = load_module('customer_wallet_routes_tests', 'customer-wallet-routes.py')

CONFIG = (
    b'server {\n'
    b'    listen 443 ssl;\n'
    b'    server_name staging-auth.ogabassey.com;\n'
    b'    ssl_certificate /etc/ssl/example.pem;\n'
    + funding.LOCATIONS
    + drafts.LOCATIONS
    + intake.LOCATION
    + b'    location / { return 503; }\n'
    b'}\n'
    b'# preserved after the server\n'
)


def digest(content=CONFIG):
    return hashlib.sha256(content).hexdigest()


class CustomerWalletRouteTests(unittest.TestCase):
    def test_adds_exact_wallet_route_and_preserves_all_existing_bytes(self):
        rendered = routes.render_config(CONFIG, digest())

        self.assertEqual(rendered.replace(b'\n' + routes.LOCATIONS, b'', 1), CONFIG)
        self.assertEqual(rendered.count(b'location = /api/storefront/customer/wallet {'), 1)
        self.assertEqual(rendered.count(b'proxy_pass http://127.0.0.1:4795;'), 4)
        for existing_path in funding.FUNDING_PATHS:
            self.assertEqual(rendered.count(b'location = ' + existing_path + b' {'), 1)
        self.assertEqual(rendered.count(b'location = /api/storefront/customer/savings/drafts {'), 1)
        self.assertEqual(rendered.count(b'location = /piggyvest/intake {'), 1)

    def test_wallet_route_allows_only_get_and_uses_trusted_no_store_headers(self):
        rendered = routes.render_config(CONFIG, digest())

        self.assertIn(
            b'location = /api/storefront/customer/wallet {\n'
            b'        if ($request_method !~ ^(GET)$) { return 405; }',
            rendered,
        )
        self.assertIn(b'proxy_set_header Host staging.ogabassey.com;', rendered)
        self.assertIn(b'proxy_set_header X-Forwarded-Host staging.ogabassey.com;', rendered)
        self.assertIn(b'proxy_set_header X-Forwarded-Proto https;', rendered)
        self.assertIn(b'proxy_set_header X-Forwarded-Port 443;', rendered)
        self.assertIn(b'proxy_set_header X-Forwarded-For $remote_addr;', rendered)
        self.assertIn(b'proxy_set_header X-Real-IP $remote_addr;', rendered)
        self.assertIn(b'proxy_set_header Forwarded "";', rendered)
        self.assertIn(b'proxy_set_header x-middleware-subrequest "";', rendered)
        self.assertIn(b'proxy_hide_header Cache-Control;', rendered)
        self.assertIn(b'add_header Cache-Control "no-store" always;', rendered)
        self.assertIn(b'access_log off;', rendered)
        self.assertNotIn(b'location /api/', rendered)

    def test_rejects_unpinned_config_and_bad_hash(self):
        for content, expected in (
            (CONFIG, '0' * 64),
            (CONFIG + b'# changed\n', digest()),
            (CONFIG, 'x' * 64),
        ):
            with self.subTest(expected=expected), self.assertRaises(routes.HELPERS.Refused):
                routes.render_config(content, expected)

    def test_rejects_missing_duplicate_aliased_or_non_final_trusted_host(self):
        candidates = (
            CONFIG.replace(routes.HOST, b'other.example'),
            CONFIG + CONFIG,
            CONFIG.replace(routes.HOST, routes.HOST + b' other.example'),
            CONFIG + b'server { server_name other.example; }\n',
        )
        for content in candidates:
            with self.subTest(content=content), self.assertRaises(routes.HELPERS.Refused):
                routes.render_config(content, digest(content))

    def test_rejects_preexisting_wallet_route(self):
        seeded = CONFIG.replace(
            b'    location / { return 503; }',
            b'    location = /api/storefront/customer/wallet { return 503; }',
        )
        with self.assertRaises(routes.HELPERS.Refused):
            routes.render_config(seeded, digest(seeded))


if __name__ == '__main__':
    unittest.main()
