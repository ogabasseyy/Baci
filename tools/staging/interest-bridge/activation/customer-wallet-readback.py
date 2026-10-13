import hashlib
import importlib.util
import json
import os
from pathlib import Path
import ssl
import stat
import tempfile
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPSHandler


SOURCE = Path('/home/bassey/baci-interest-confirm-20261001.o5wK6hku/provider_interest_check.py')
SOURCE_PIN = '900b18bc7b25823a8ea36a663ee856a64eb8d37511502b45a3d5d9659ba365b1'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
WEBHOOK_CUSTOMER = 'c096507d-dc32-45d2-9c01-871a27abfd10'
API_CUSTOMER = '01M2T3PAHG3P5A32REX8MH3HD7'


def load_verified_provider(content, directory):
    descriptor, name = tempfile.mkstemp(prefix='verified-provider-', suffix='.py', dir=directory)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(content)
    specification = importlib.util.spec_from_file_location('provider', name)
    provider = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(provider)
    return provider


def summarize(data):
    container = data.get('paginatedPayload', data) if isinstance(data, dict) else None
    if (not isinstance(container, dict) or not isinstance(container.get('edges'), list)
            or container.get('pageInfo', {}).get('hasNextPage') is not False
            or len(container['edges']) > 100):
        raise ValueError('customer-pagination-refused')
    fields = ('id', 'customer_id', 'api_customer_id', 'business_id',
              'third_party_identifier', 'interest_enabled', 'enable_interest_accrual')
    result = []
    for row in container['edges']:
        if not isinstance(row, dict):
            raise ValueError('customer-row-refused')
        item = {field: row.get(field) for field in fields}
        if item['business_id'] not in (None, '01M2381RG34HQJMHQKE7DWDACR'):
            raise ValueError('customer-business-refused')
        result.append(item)
    return result


def run():
    if os.geteuid() != 0:
        raise ValueError('root-required')
    info = SOURCE.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or SOURCE.is_symlink():
        raise ValueError('provider-source-metadata')
    content = SOURCE.read_bytes()
    if hashlib.sha256(content).hexdigest() != SOURCE_PIN:
        raise ValueError('provider-source-pin')
    provider = load_verified_provider(content, Path(__file__).parent)
    configuration = provider.read_configuration()
    opener = build_opener(provider.NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    reports = []
    for query in ({'customer_id': WEBHOOK_CUSTOMER}, {'customer_id': API_CUSTOMER},
                  {'third_party_identifier': CUSTOMER}):
        request = Request(provider.ORIGIN + '/api/v1/customers?' + urlencode({'limit': 100, **query}),
            headers={'Authorization': 'Bearer ' + configuration['apiSecret'], 'Accept': 'application/json',
                     'User-Agent': 'Baci-Staging-ReadOnly/1.0'},
            method='GET')
        try:
            with opener.open(request, timeout=15) as response:
                content = response.read(262145)
                if len(content) > 262144:
                    raise ValueError('oversized-customer-response')
                body = json.loads(content)
                if body.get('status') is not True:
                    raise ValueError('customer-result-refused')
                reports.append(dict(filter=query, http=response.status, customers=summarize(body.get('data'))))
        except provider.HTTPError as error:
            category = provider.classify_error(error.read(262145), error.headers.get('Content-Type', ''))
            reports.append(dict(filter=query, http=error.code, errorCategory=category))
    print(json.dumps(dict(status='customer-wallet-readback', readOnly=True, changesMade=False, lookups=reports)))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps(dict(status='refused', errorType=type(error).__name__, redacted=True,
                             changesMade=False)))
        raise SystemExit(1)
