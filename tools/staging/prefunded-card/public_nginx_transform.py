import hashlib
import hmac
import re

from treasury_owner_contract import Refused


HOST = b'staging-auth.ogabassey.com'
NAMED_FALLBACK = b'@baci_gateway_unavailable'
FALLBACK_DIRECTIVES = (
    (b'internal',), (b'default_type', b'application/json'),
    (b'return', b'503', b'{"error":"Request unavailable"}'),
)
GATEWAY_ROOT_DIRECTIVES = (
    (b'proxy_intercept_errors', b'on'),
    (b'proxy_next_upstream', b'off'),
    (b'error_page', b'502', b'504', b'=', NAMED_FALLBACK),
    (b'proxy_pass', b'http://unix:/run/baci-savings-gateway/ingress.sock'),
    (b'proxy_set_header', b'Host', b'$host'),
    (b'proxy_set_header', b'X-Real-IP', b'$remote_addr'),
    (b'proxy_set_header', b'X-Forwarded-For', b'$proxy_add_x_forwarded_for'),
    (b'proxy_set_header', b'X-Forwarded-Proto', b'$scheme'),
)
ROUTES = (
    (b'/api/storefront/customer/savings/card-checkout', b'GET|POST|PATCH'),
    (b'/api/csrf', b'GET'),
    (b'/savings/card-return', b'GET|HEAD'),
)
ASSET_PREFIX = b'/savings/card-assets/_next/static/'
ASSET_SEGMENT = b'[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*'
ASSET_PATTERN = b'^' + ASSET_PREFIX + ASSET_SEGMENT + b'(?:/' + ASSET_SEGMENT + b')*(?:[?].*)?$'
LIMIT = 262144
TOKEN = re.compile(rb'''\s+|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};"'\#]+''')
COMMON = b'''        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header x-middleware-subrequest "";
        proxy_pass_request_headers on;
        proxy_next_upstream off;
        proxy_intercept_errors off;
        proxy_redirect off;
        proxy_cache off;
        proxy_hide_header Cache-Control;
        client_max_body_size 16k;
        proxy_connect_timeout 3s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
        add_header Cache-Control "no-store" always;
        access_log off;
        error_log /dev/null emerg;
'''


def _location(selector, methods, pattern, upstream):
    return (b'    location ' + selector + b' {\n'
            b'        if ($request_method !~ ^(' + methods + b')$) { return 405; }\n'
            b'        if ($request_uri !~ "' + pattern + b'") { return 404; }\n'
            + COMMON + b'        proxy_pass http://127.0.0.1:4800' + upstream + b';\n    }\n')


LOCATIONS = b'\n'.join(
    _location(b'= ' + path, methods, b'^' + path + b'(?:[?].*)?$', b'')
    for path, methods in ROUTES
) + b'\n' + _location(b'^~ ' + ASSET_PREFIX, b'GET|HEAD', ASSET_PATTERN, b'/_next/static/')


def _closing_brace(content):
    position = 0
    stack, directive = [], []
    servers = names = 0
    closing = None
    locations = set()
    fallback_directives = []
    root_directives = []
    managed_root = False
    for match in TOKEN.finditer(content):
        if match.start() != position:
            raise Refused('Nginx token shape refused')
        position = match.end()
        token = match.group()
        if token.isspace() or token.startswith(b'#'):
            continue
        if closing is not None:
            raise Refused('Nginx requires exactly one server block')
        if token == b'{':
            if not directive:
                raise Refused('Nginx unnamed block refused')
            if not stack:
                if directive != [b'server']:
                    raise Refused('Nginx top-level scope refused')
                servers += 1
            elif directive[0] in (b'server', b'server_name'):
                raise Refused('Nginx nested server refused')
            if directive[0] == b'location':
                if len(stack) != 1 or len(directive) not in (2, 3):
                    raise Refused('Nginx location scope refused')
                modifier = directive[1] if len(directive) == 3 else b''
                path = directive[-1]
                identity = (modifier == b'=', path)
                named_fallback = modifier == b'' and path == NAMED_FALLBACK
                if (modifier not in (b'', b'=', b'^~') or identity in locations
                        or (path == b'/' and modifier != b'')
                        or (not named_fallback and not re.fullmatch(rb'/[A-Za-z0-9_./-]*', path))
                        or (path != b'/' and modifier != b'=' and any(
                            route.startswith(path) for route in (*[route for route, _ in ROUTES], ASSET_PREFIX)))):
                    raise Refused('Nginx shared, wildcard or duplicate location refused')
                locations.add(identity)
            if stack and stack[-1] in ([b'location', b'/'], [b'location', NAMED_FALLBACK]):
                raise Refused('Nginx fallback must stay disabled')
            stack.append(directive)
            directive = []
        elif token == b'}':
            if directive or not stack:
                raise Refused('Nginx block shape refused')
            if stack[-1] == [b'location', b'/']:
                managed_root = tuple(root_directives) == GATEWAY_ROOT_DIRECTIVES
                if not managed_root and tuple(root_directives) not in (((b'return', b'404'),), ((b'return', b'503'),)):
                    raise Refused('Nginx fallback must stay disabled')
            if stack[-1] == [b'location', NAMED_FALLBACK] and tuple(fallback_directives) != FALLBACK_DIRECTIVES:
                raise Refused('Nginx named gateway fallback differs')
            stack.pop()
            if not stack:
                closing = match.start()
        elif token == b';':
            if not stack or not directive:
                raise Refused('Nginx directive scope refused')
            if directive[0] == b'server_name':
                if len(stack) != 1 or directive != [b'server_name', HOST]:
                    raise Refused('Nginx server identity refused')
                names += 1
            if stack[-1] == [b'location', b'/']:
                root_directives.append(tuple(directive))
            if stack[-1] == [b'location', NAMED_FALLBACK]:
                fallback_directives.append(tuple(directive))
            directive = []
        else:
            plain = token[1:-1] if token[:1] in (b'"', b"'") else token
            if any(path in plain for path, _ in ROUTES) or b'/savings/card-assets' in plain:
                raise Refused('Existing public checkout route refused')
            directive.append(plain)
    if position != len(content) or stack or directive or closing is None or servers != 1 or names != 1:
        raise Refused('Nginx single-server shape refused')
    if managed_root and (False, NAMED_FALLBACK) not in locations:
        raise Refused('Nginx named gateway fallback differs')
    return closing


def render_config(content, expected_sha256):
    if (type(content) is not bytes or not 0 < len(content) <= LIMIT or b'\0' in content
            or type(expected_sha256) is not str or not re.fullmatch(r'[a-f0-9]{64}', expected_sha256)):
        raise Refused('Nginx input or reviewed pin refused')
    if not hmac.compare_digest(hashlib.sha256(content).hexdigest(), expected_sha256):
        raise Refused('Nginx predecessor digest changed')
    closing = _closing_brace(content)
    return content[:closing] + b'\n' + LOCATIONS + content[closing:]
