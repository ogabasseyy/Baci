import hashlib
from pathlib import Path
import re
import unittest

from public_nginx_transform import HOST, LOCATIONS, ROUTES, Refused, render_config


CONFIG = b'''# reviewed synthetic fixture; not live configuration
server {
    listen 443 ssl;
    server_name staging-auth.ogabassey.com;
    ssl_certificate /etc/ssl/synthetic.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }
    location /auth/v1/ { proxy_pass http://127.0.0.1:54321; }
    location /rest/v1/ { proxy_pass http://127.0.0.1:54322; }
    location = /api/storefront/customer/savings/drafts { proxy_pass http://127.0.0.1:4792; }
    location = /api/storefront/customer/savings/funding { proxy_pass http://127.0.0.1:4795; }
    location / { return 404; }
}
# trailing comment with braces: { }
'''


def digest(content=CONFIG):
    return hashlib.sha256(content).hexdigest()


class TransformTests(unittest.TestCase):
    def managed_root(self):
        source = (Path(__file__).resolve().parents[1] / 'isolated-savings/managed-nginx-activation.mjs').read_bytes()
        guards = re.search(rb'const gatewayGuards = `([^`]+)`;', source).group(1)
        upstream = re.search(rb"const gatewayUpstream =\s*'([^']+)';", source).group(1)
        return (b'location / {\n    ' + guards + b'\n    ' + upstream + b'\n'
                b'    proxy_set_header Host $host;\n'
                b'    proxy_set_header X-Real-IP $remote_addr;\n'
                b'    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
                b'    proxy_set_header X-Forwarded-Proto $scheme;\n  }')

    def test_preserves_the_existing_managed_unix_gateway_root_without_broadening_it(self):
        content = CONFIG.replace(b'location / { return 404; }', self.managed_root() + b'\n' + self.gateway_fallback())
        rendered = render_config(content, digest(content))
        self.assertEqual(rendered.replace(b'\n' + LOCATIONS, b'', 1), content)
        self.assertEqual(rendered.count(self.managed_root()), 1)
        self.assertNotIn(b'ingress.sock', LOCATIONS)

    def test_gateway_root_exception_refuses_other_upstreams_missing_guards_or_foreign_directives(self):
        root = self.managed_root()
        for changed in (
            root.replace(b'http://unix:/run/baci-savings-gateway/ingress.sock', b'http://127.0.0.1:9999'),
            root.replace(b'ingress.sock', b'other.sock'),
            root.replace(b'proxy_intercept_errors on;', b''),
            root.replace(b'proxy_next_upstream off;', b'proxy_next_upstream error;'),
            root.replace(b'502 504', b'502 503 504'),
            root.replace(b'$host', b'unreviewed.example'),
            root.replace(b'proxy_set_header Host $host;', b'include /etc/nginx/foreign.conf;'),
            root.replace(b'proxy_pass ', b'proxy_pass http://elsewhere; proxy_pass '),
        ):
            content = CONFIG.replace(b'location / { return 404; }', changed + b'\n' + self.gateway_fallback())
            with self.subTest(root=changed), self.assertRaises(Refused):
                render_config(content, digest(content))
        content = CONFIG.replace(b'location / { return 404; }', root)
        with self.assertRaises(Refused):
            render_config(content, digest(content))

    def gateway_fallback(self):
        source = Path(__file__).resolve().parents[1] / 'isolated-savings/managed-nginx-activation.mjs'
        return re.search(rb'const unavailableLocation = `([^`]+)`;', source.read_bytes()).group(1)

    def test_root_modifiers_cannot_bypass_the_closed_gateway_contract(self):
        for modifier in (b'^~ ', b'= '):
            for body in (b'proxy_pass http://foreign.example;', b'include /etc/nginx/foreign.conf;',
                         b'return 404;'):
                changed = b'location ' + modifier + b'/ { ' + body + b' }'
                content = CONFIG.replace(b'location / { return 404; }', changed)
                with self.subTest(modifier=modifier, body=body), self.assertRaises(Refused):
                    render_config(content, digest(content))

    def test_preserves_exact_existing_managed_gateway_named_503_fallback(self):
        fallback = self.gateway_fallback()
        content = CONFIG.replace(b'    location / {', fallback + b'\n    location / {')
        content = content.replace(b'location /auth/v1/ {',
            b'location /auth/v1/ { error_page 502 504 = @baci_gateway_unavailable;')
        rendered = render_config(content, digest(content))
        self.assertEqual(rendered.replace(b'\n' + LOCATIONS, b'', 1), content)
        self.assertEqual(rendered.count(fallback), 1)
        self.assertNotIn(b'@baci_gateway_unavailable', LOCATIONS)

    def test_named_gateway_exception_refuses_other_names_modifiers_duplicates_and_bodies(self):
        fallback = self.gateway_fallback()
        changes = [fallback.replace(b'@baci_gateway_unavailable', b'@other'),
            fallback.replace(b'location @', b'location = @'),
            fallback.replace(b'location @', b'location ^~ @'), fallback + b'\n' + fallback,
            fallback.replace(b'return 503', b'return 200'),
            fallback.replace(b'Request unavailable', b'Unreviewed response'),
            fallback.replace(b'    internal;', b''),
            fallback.replace(b'    internal;', b'    proxy_pass http://127.0.0.1:4800;'),
            fallback.replace(b'    internal;', b'    internal; include /etc/nginx/unreviewed.conf;'),
            fallback.replace(b'    internal;', b'    if ($request_method = GET) { return 503; }')]
        for changed in changes:
            content = CONFIG.replace(b'    location / {', changed + b'\n    location / {')
            with self.subTest(fallback=changed), self.assertRaises(Refused):
                render_config(content, digest(content))

    def test_preserves_all_predecessor_bytes_and_only_inserts_exact_locations(self):
        rendered = render_config(CONFIG, digest())
        self.assertNotEqual(rendered, CONFIG)
        self.assertEqual(rendered.replace(b'\n' + LOCATIONS, b'', 1), CONFIG)
        self.assertEqual(LOCATIONS.count(b'location = '), 3)
        for path, methods in ROUTES:
            self.assertIn(b'location = ' + path + b' {', LOCATIONS)
            self.assertIn(b'if ($request_method !~ ^(' + methods + b')$) { return 405; }', LOCATIONS)
        self.assertEqual(ROUTES, (
            (b'/api/storefront/customer/savings/card-checkout', b'GET|POST|PATCH'),
            (b'/api/csrf', b'GET'), (b'/savings/card-return', b'GET|HEAD')))

    def test_pins_transport_host_headers_and_never_retries_financial_mutations(self):
        for directive in (
            b'proxy_set_header Host staging.ogabassey.com;',
            b'proxy_set_header X-Forwarded-Host staging.ogabassey.com;',
            b'proxy_set_header X-Forwarded-Proto https;',
            b'proxy_set_header X-Forwarded-Port 443;',
            b'proxy_set_header X-Forwarded-For $remote_addr;',
            b'proxy_set_header Forwarded "";',
            b'proxy_set_header x-middleware-subrequest "";',
            b'proxy_next_upstream off;', b'proxy_intercept_errors off;',
            b'proxy_redirect off;', b'proxy_cache off;',
            b'proxy_hide_header Cache-Control;',
            b'client_max_body_size 16k;', b'proxy_read_timeout 30s;',
            b'add_header Cache-Control "no-store" always;',
            b'access_log off;', b'error_log /dev/null emerg;',
        ):
            with self.subTest(directive=directive):
                self.assertEqual(LOCATIONS.count(directive), 4)
        self.assertEqual(LOCATIONS.count(b'proxy_pass http://127.0.0.1:4800;'), 3)
        for forbidden in (b'location /api', b'location /_next', b'location ~',
                          b'card-contributions', b'auth_basic off', b'satisfy any',
                          b'$proxy_add_x_forwarded_for', b'proxy_set_header Authorization',
                          b'proxy_set_header Cookie', b'proxy_set_header Origin'):
            self.assertNotIn(forbidden, LOCATIONS)

    def test_static_prefix_is_the_only_prefix_and_rewrites_without_dropping_queries(self):
        self.assertEqual(LOCATIONS.count(b'location ^~ '), 1)
        self.assertIn(b'location ^~ /savings/card-assets/_next/static/ {', LOCATIONS)
        self.assertIn(b'proxy_pass http://127.0.0.1:4800/_next/static/;', LOCATIONS)
        self.assertNotIn(b'rewrite ', LOCATIONS)
        self.assertNotIn(b'$args', LOCATIONS)
        self.assertNotIn(b'$uri', LOCATIONS)
        block = LOCATIONS.split(b'location ^~ ')[1]
        method = re.search(rb'if \(\$request_method !~ (\S+)\)', block).group(1)
        for allowed in (b'GET', b'HEAD'):
            self.assertIsNotNone(re.fullmatch(method, allowed))
        for denied in (b'POST', b'PATCH', b'PUT', b'OPTIONS', b'DELETE', b'TRACE', b'get'):
            self.assertIsNone(re.fullmatch(method, denied))
        self.assertIn(b') { return 405; }', block)

    def test_static_raw_path_guard_refuses_escaping_traversal_and_normalization_aliases(self):
        block = LOCATIONS.split(b'location ^~ ')[1]
        pattern = re.search(rb'if \(\$request_uri !~ "([^"]+)"\)', block).group(1)
        prefix = b'/savings/card-assets/_next/static/'
        for suffix in (b'chunks/a-123.js', b'css/123.css', b'media/abc.woff2',
                       b'build/_buildManifest.js', b'chunks/app/savings/card-return/page-123.js',
                       b'chunks/123.js?dpl=test&encoded=%2F..%2F&reference=synthetic'):
            with self.subTest(suffix=suffix):
                self.assertIsNotNone(re.fullmatch(pattern, prefix + suffix))
        for path in (prefix, prefix + b'../server.js', prefix + b'./file.js',
                     prefix + b'chunks/../../api/csrf', prefix + b'chunks//a.js',
                     prefix + b'%2e%2e/a.js', prefix + b'%252e%252e/a.js',
                     prefix + b'chunks%2fa.js', prefix + b'chunks\\a.js',
                     prefix + b'chunks/a.js#x', prefix + b'chunks/a.js;secret',
                     prefix + b'chunks/(store)/page.js', prefix + b'chunks/@group/page.js',
                     b'/_next/static/chunks/a.js', b'//savings/card-assets/_next/static/a.js',
                     b'/other/../savings/card-assets/_next/static/a.js',
                     b'/savings/card-assets/_next/staticx/a.js'):
            with self.subTest(path=path):
                self.assertIsNone(re.fullmatch(pattern, path))

    def test_exact_raw_route_guards_preserve_queries_but_reject_aliases(self):
        for path, allowed in ROUTES:
            block = LOCATIONS.split(b'location = ' + path + b' {')[1].split(b'\n    }')[0]
            pattern = re.search(rb'if \(\$request_uri !~ "([^"]+)"\)', block).group(1)
            self.assertIsNotNone(re.fullmatch(pattern, path + b'?value=%2F&reference=test'))
            for invalid in (path + b'/', b'/other/..' + path, path.replace(b'/', b'//', 1)):
                self.assertIsNone(re.fullmatch(pattern, invalid))
            method_pattern = re.search(rb'if \(\$request_method !~ (\S+)\)', block).group(1)
            for method in (b'GET', b'HEAD', b'POST', b'PATCH', b'PUT', b'DELETE', b'OPTIONS', b'TRACE'):
                self.assertEqual(bool(re.fullmatch(method_pattern, method)), method in allowed.split(b'|'))

    def test_rejects_wrong_missing_or_malformed_hashes(self):
        for value in (None, '', '0' * 64, 'f' * 63, 'z' * 64, 7):
            with self.subTest(value=value), self.assertRaises(Refused):
                render_config(CONFIG, value)

    def test_rejects_every_second_server_even_before_the_target(self):
        other = b'server { listen 443 ssl; server_name other.example; }\n'
        for content in (other + CONFIG, CONFIG + other, CONFIG + CONFIG):
            with self.subTest(content=content), self.assertRaises(Refused):
                render_config(content, digest(content))

    def test_requires_one_exact_host_at_the_top_server_level(self):
        for replacement in (b'other.example', HOST + b' other.example', b'*.' + HOST,
                            HOST + b'; server_name other.example', HOST + b'; server_name ' + HOST):
            content = CONFIG.replace(HOST, replacement)
            with self.subTest(replacement=replacement), self.assertRaises(Refused):
                render_config(content, digest(content))
        content = CONFIG.replace(b'server_name ' + HOST + b';', b'')
        content = content.replace(b'location / {', b'location / { server_name ' + HOST + b';')
        with self.assertRaises(Refused):
            render_config(content, digest(content))

    def test_refuses_existing_new_routes_including_quoted_and_prefix_locations(self):
        for path in [path for path, _ in ROUTES] + [b'/savings/card-assets/']:
            for location in (b'location = ' + path, b'location "' + path + b'"', b'location ^~ ' + path):
                content = CONFIG.replace(b'location / { return 404; }', location + b' { return 404; }')
                with self.subTest(location=location), self.assertRaises(Refused):
                    render_config(content, digest(content))
        installed = render_config(CONFIG, digest())
        with self.assertRaises(Refused):
            render_config(installed, digest(installed))

    def test_comments_and_quoted_braces_do_not_change_the_insertion_point(self):
        content = CONFIG.replace(b'location / {', b'add_header X-Test "{ quoted }";\n    location / {')
        content += b'# location = /api/csrf { ignored }\n'
        rendered = render_config(content, digest(content))
        self.assertEqual(rendered.replace(b'\n' + LOCATIONS, b'', 1), content)
        self.assertTrue(rendered.endswith(b'}\n# trailing comment with braces: { }\n'
                                          b'# location = /api/csrf { ignored }\n'))

    def test_refuses_duplicate_locations_and_shared_or_wildcard_critical_routes(self):
        for location in (b'location /api/', b'location ^~ /api/storefront/customer/savings/',
                         b'location /savings/', b'location ~ ^/api/.*', b'location ~* card.*',
                         b'location /api/csrf*', b'location $selected_path',
                         b'location /auth/v1/'):
            content = CONFIG.replace(b'location / { return 404; }', location + b' { return 404; }')
            with self.subTest(location=location), self.assertRaises(Refused):
                render_config(content, digest(content))
        for fallback in (b'proxy_pass http://127.0.0.1:3000;', b'return 302 /api/csrf;',
                         b'include /etc/nginx/other.conf;'):
            content = CONFIG.replace(b'location / { return 404; }', b'location / { ' + fallback + b' }')
            with self.subTest(fallback=fallback), self.assertRaises(Refused):
                render_config(content, digest(content))

    def test_rejects_unbalanced_nested_top_level_or_invalid_inputs(self):
        for content in (CONFIG + b'}', CONFIG + b'"', CONFIG[:-42], b'http {' + CONFIG + b'}',
                        CONFIG.replace(b'location / {', b'server {'),
                        b'include other.conf;\n' + CONFIG, CONFIG + b'include other.conf;',
                        CONFIG + b'\0', b' ' * 262145, b'', 'not bytes'):
            expected = digest(content) if isinstance(content, bytes) else digest()
            with self.subTest(kind=type(content).__name__), self.assertRaises(Refused):
                render_config(content, expected)


if __name__ == '__main__':
    unittest.main()
