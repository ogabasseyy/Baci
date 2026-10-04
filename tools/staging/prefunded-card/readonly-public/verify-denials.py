import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'interest-bridge/activation'))
from phone_authentication import API, NoRedirects, authenticate


GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
PATH = '/api/storefront/customer/savings/card-checkout'


def request(method, path, headers, body=None):
    opener = build_opener(ProxyHandler({}), NoRedirects(), HTTPSHandler())
    value = Request(API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Origin': API,
                 'User-Agent': 'Baci-Staging-ReadOnly/1.0', **headers})
    try:
        response = opener.open(value, timeout=20)
    except HTTPError as error:
        response = error
    with response:
        content = response.read(65537)
        if len(content) > 65536 or response.headers.get_content_type() != 'application/json':
            raise ValueError('bounded-json-response')
        return response.status, json.loads(content)


def verify(headers, send=request):
    status, capability = send('GET', PATH + '?goalId=' + GOAL, headers)
    if status != 200 or capability != dict(goalId=GOAL, enabled=False, maximumAmountKobo=0, currency='NGN'):
        raise ValueError('readonly-capability-required-before-denial-probes')
    checks = [{'method': 'GET', 'http': status, 'enabled': False, 'maximumAmountKobo': 0}]
    bodies = (
        ('POST', dict(goalId=GOAL, amountKobo=10000,
            idempotencyKey='10000000-0000-4000-8000-000000000099',
            consent=dict(version='prefunded-first-card-v1', oneTimeCharge=True, saveCard=True))),
        ('PATCH', dict(goalId=GOAL, intentId='d8bcf921-61b3-4647-90e2-5648e4d6967d')),
    )
    for method, body in bodies:
        status, response = send(method, PATH, headers, body)
        if status != 503 or response != dict(error='First-card savings checkout unavailable',
                                             code='PREFUNDED_CARD_CHECKOUT_UNAVAILABLE'):
            raise ValueError('mutation-denial-required')
        checks.append({'method': method, 'http': status})
    return {'status': 'authenticated-readonly-checkout-verified', 'checks': checks,
            'cardPaymentsEnabled': False, 'newPaymentStarted': False}


if __name__ == '__main__':
    try:
        print(json.dumps(verify(authenticate())))
    except Exception as error:
        print(json.dumps({'status': 'checkout-denial-check-refused', 'redacted': True,
                          'errorType': type(error).__name__}))
        raise SystemExit(1)
