import hashlib
import hmac
import importlib.util
from pathlib import Path
import re


HELPERS_PATH = Path(__file__).with_name('install-customer-funding-routes.py')
HELPERS_SPEC = importlib.util.spec_from_file_location('customer_funding_route_helpers', HELPERS_PATH)
if HELPERS_SPEC is None or HELPERS_SPEC.loader is None:
    raise RuntimeError('Could not load customer route installer helpers.')
HELPERS = importlib.util.module_from_spec(HELPERS_SPEC)
HELPERS_SPEC.loader.exec_module(HELPERS)

HOST = HELPERS.HOST
WALLET_PATH = b'/api/storefront/customer/wallet'
LOCATIONS = b'''    location = /api/storefront/customer/wallet {
        if ($request_method !~ ^(GET)$) { return 405; }
        client_max_body_size 16k;
        proxy_pass http://127.0.0.1:4795;
        proxy_set_header Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header x-middleware-subrequest "";
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
        access_log off;
    }
'''


def render_config(content, expected_sha256):
    if (
        not isinstance(content, bytes)
        or not isinstance(expected_sha256, str)
        or not re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256)
        or not hmac.compare_digest(
            hashlib.sha256(content).hexdigest(), expected_sha256.lower()
        )
    ):
        raise HELPERS.Refused()

    tokens = []
    offset = 0
    for match in HELPERS.TOKEN.finditer(content):
        if match.start() != offset:
            raise HELPERS.Refused()
        offset = match.end()
        value = match.group()
        if not value.isspace() and not value.startswith(b'#'):
            tokens.append((value, match.start()))
    if offset != len(content):
        raise HELPERS.Refused()

    stack, directive, hosts, candidates = [], [], [], []
    for value, position in tokens:
        plain = value.strip(b'"\'')
        if plain == WALLET_PATH:
            raise HELPERS.Refused()
        if value == b'{':
            stack.append((tuple(directive), position))
            directive = []
        elif value == b';':
            if directive and directive[0] == b'server_name' and HOST in directive[1:]:
                if directive != [b'server_name', HOST] or len(stack) != 1 or stack[0][0] != (b'server',):
                    raise HELPERS.Refused()
                hosts.append(stack[0][1])
            directive = []
        elif value == b'}':
            if not stack or directive:
                raise HELPERS.Refused()
            block, opening = stack.pop()
            if block == (b'server',) and not stack:
                candidates.append((opening, position))
        else:
            directive.append(plain)

    if stack or directive or len(hosts) != 1:
        raise HELPERS.Refused()
    closing = next((end for opening, end in candidates if opening == hosts[0]), None)
    if closing is None or tokens[-1] != (b'}', closing):
        raise HELPERS.Refused()
    return content[:closing] + b'\n' + LOCATIONS + content[closing:]
