import hashlib
import json
import os
import shlex
import stat
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener


AUTH = 'https://staging-auth.ogabassey.com'
API = 'https://staging.ogabassey.com'
ACTOR = 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'
MERCHANT = '10000000-0000-4000-8000-000000000001'
PROFILE = '/home/bassey/baci-isolated-savings/hosted-public-client-profile.json'
FIXTURE = '/home/bassey/.staging-phone-env'
KEY_PIN = '1065d3a5c300f1d3ba3d6c42cbe0524128c57cc2032a4345bff4100cb6f7a3f2'


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def private_read(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1
                or not 0 < metadata.st_size <= 32768):
            raise ValueError('private-input-refused')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            return stream.read(32769)
    finally:
        os.close(descriptor)


def request_json(url, headers, body=None):
    origin = urlsplit(url)
    if (origin.scheme != 'https' or origin.netloc not in (AUTH[8:], API[8:])
            or origin.username is not None or origin.password is not None or origin.fragment):
        raise ValueError('origin-refused')
    request = Request(url, method='GET' if body is None else 'POST',
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Baci-Staging-ReadOnly/1.0', **headers})
    opener = build_opener(ProxyHandler({}), NoRedirects(), HTTPSHandler())
    with opener.open(request, timeout=20) as response:
        content = response.read(131073)
        if len(content) > 131072:
            raise ValueError('oversized-response')
        return response.status, json.loads(content)


def authenticate(read=private_read, request=request_json):
    profile = json.loads(read(PROFILE))
    expected = dict(mode='hosted-staging', apiOrigin=API, supabaseOrigin=AUTH,
                    expectedAuthIssuer=AUTH + '/auth/v1', merchantId=MERCHANT)
    if (any(profile.get(key) != value for key, value in expected.items())
            or not isinstance(profile.get('publicKey'), str)
            or hashlib.sha256(profile['publicKey'].encode()).hexdigest() != KEY_PIN):
        raise ValueError('profile-refused')
    fixture = {}
    for line in read(FIXTURE).decode().splitlines():
        if line.startswith(('STAGING_PHONE_EMAIL=', 'STAGING_PHONE_PASSWORD=')):
            name, value = line.split('=', 1)
            values = shlex.split(value)
            if name in fixture or len(values) != 1:
                raise ValueError('fixture-refused')
            fixture[name] = values[0]
    if fixture.get('STAGING_PHONE_EMAIL') != 'baci-staging@example.com' or not fixture.get('STAGING_PHONE_PASSWORD'):
        raise ValueError('fixture-identity-refused')
    headers = {'apikey': profile['publicKey']}
    status, session = request(AUTH + '/auth/v1/token?grant_type=password', headers,
        {'email': fixture['STAGING_PHONE_EMAIL'], 'password': fixture['STAGING_PHONE_PASSWORD']})
    if (status != 200 or not isinstance(session, dict) or session.get('user', {}).get('id') != ACTOR
            or not isinstance(session.get('access_token'), str) or not session['access_token']):
        raise ValueError('authenticated-identity-refused')
    return {**headers, 'Authorization': 'Bearer ' + session['access_token']}
