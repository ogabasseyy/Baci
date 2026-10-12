import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

from release_contract import _require

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from phone_authentication import API, NoRedirects, authenticate
from treasury_owner_io import read_file

GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
PATH = '/api/storefront/customer/savings/card-checkout'


def root_fixture(path):
    _require(path in ('/home/bassey/baci-isolated-savings/hosted-public-client-profile.json',
                     '/home/bassey/.staging-phone-env'), 'owner_public_fixture_scope_refused')
    return read_file(Path(path), 1001, 0o600, 32768)


def request(method, path, headers, body=None):
    opener = build_opener(ProxyHandler({}), NoRedirects(), HTTPSHandler())
    value = Request(API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Origin': API,
                 'User-Agent': 'Baci-Staging-ReadOnly/1.0', **headers})
    try:
        response = opener.open(value, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        content = response.read(65537)
        _require(len(content) <= 65536 and response.headers.get_content_type() == 'application/json',
                 'owner_public_response_refused')
        return response.status, json.loads(content)


def verify(send=request, auth=authenticate, artifacts=None):
    _require(callable(artifacts) and artifacts() is True, 'owner_public_artifacts_unproved')
    headers = auth(read=root_fixture)
    status, capability = send('GET', PATH + '?goalId=' + GOAL, headers)
    _require(status == 200 and capability == {'goalId': GOAL, 'enabled': False,
             'maximumAmountKobo': 0, 'currency': 'NGN'}, 'owner_public_readonly_required')
    bodies = [('POST', {'goalId': GOAL, 'amountKobo': 10000,
        'idempotencyKey': '10000000-0000-4000-8000-000000000099',
        'consent': {'version': 'prefunded-first-card-v1', 'oneTimeCharge': True, 'saveCard': True}}),
        ('PATCH', {'goalId': GOAL, 'intentId': 'd8bcf921-61b3-4647-90e2-5648e4d6967d'})]
    statuses = {}
    for method, body in bodies:
        actual, response = send(method, PATH, headers, body)
        _require(actual == 503 and response == {'error': 'First-card savings checkout unavailable',
            'code': 'PREFUNDED_CARD_CHECKOUT_UNAVAILABLE'}, 'owner_public_mutation_denial_unproved')
        statuses[method] = actual
    return {'archiveSha256': '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2',
        'manifestSha256': '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8',
        'getStatus': status, 'enabled': False, 'maximumAmountKobo': 0,
        'postStatus': statuses['POST'], 'patchStatus': statuses['PATCH'], 'mutationsEnabled': False}
