from html.parser import HTMLParser
import http.client
import json
import re
import ssl
import time

from public_service_contract import probe_contract
from treasury_owner_contract import DEADLINE_EPOCH, Refused


HOST = 'staging-auth.ogabassey.com'
PREFIX = '/savings/card-assets/_next/static/'
ASSET = re.compile(r'^' + re.escape(PREFIX) + r'[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*(?:/[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*)*$')


def request(method, path):
    if time.time() >= DEADLINE_EPOCH:
        raise Refused('Public HTTP staging deadline expired')
    connection = http.client.HTTPSConnection(HOST, timeout=8, context=ssl.create_default_context())
    try:
        connection.request(method, path, body=b'{}' if method in ('POST', 'PATCH', 'PUT') else None,
                           headers={'Content-Type': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        body = response.read(4_194_305)
        if len(body) > 4_194_304:
            raise Refused('Public HTTP response exceeds limit')
        return response.status, response.getheader('Content-Type', '').split(';', 1)[0], body
    finally:
        connection.close()


def check(method, path, expected, json_required=False):
    status, kind, body = request(method, path)
    if status != expected:
        raise Refused('Public HTTP status differs')
    if json_required:
        try:
            if kind != 'application/json' or not isinstance(json.loads(body), dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            raise Refused('Public HTTP JSON contract differs') from None
    return kind, body


def baseline():
    for path in ('/auth/v1/user', '/api/storefront/customer/wallet',
                 '/api/storefront/customer/savings/goals', '/api/storefront/customer/savings/drafts'):
        check('GET', path, 401, True)
    check('GET', '/piggyvest/intake', 405)
    return True


def asset_paths(document):
    class Assets(HTMLParser):
        def __init__(self):
            super().__init__()
            self.paths = set()

        def handle_starttag(self, tag, attrs):
            for name, value in attrs:
                if tag in ('script', 'link') and name in ('src', 'href') and value and value.startswith(PREFIX):
                    if not ASSET.fullmatch(value):
                        raise Refused('Callback asset path refused')
                    self.paths.add(value)

    parser = Assets()
    parser.feed(document.decode('utf8'))
    if not 1 <= len(parser.paths) <= 32:
        raise Refused('Callback assets missing or excessive')
    return sorted(parser.paths)


def public_routes():
    callback = None
    for method, path, status in probe_contract():
        kind, body = check(method, path, status, status == 401 or path == '/api/csrf' and status == 200)
        if path == '/savings/card-return' and method == 'GET':
            if kind != 'text/html':
                raise Refused('Callback document refused')
            callback = body
    for path in asset_paths(callback):
        kind, _ = check('GET', path, 200)
        if kind not in ('application/javascript', 'text/javascript', 'text/css'):
            raise Refused('Callback asset content type refused')
    return True
