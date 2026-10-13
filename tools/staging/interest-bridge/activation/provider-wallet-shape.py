import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import types
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener


PROVIDER_HELPER = Path(__file__).with_name('provider_interest_check.py')
PROVIDER_HELPER_SHA256 = '900b18bc7b25823a8ea36a663ee856a64eb8d37511502b45a3d5d9659ba365b1'
PROVIDER_ORIGIN = 'https://staging.piggyvest.business'
WALLETS = (
    ('existing', '01M3CQX27G9687EFSF1TKYMPR9'),
    ('empty_interest_true', '01M3W0Y93XHJY9RPQ2G75X81WG'),
)
API_CUSTOMER_ID = '01M2T3PAHG3P5A32REX8MH3HD7'
WEBHOOK_CUSTOMER_ID = 'c096507d-dc32-45d2-9c01-871a27abfd10'
USER_AGENT = 'Baci-Staging-ReadOnly/1.0'
MAX_RESPONSE_BYTES = 262144
MAX_PROVIDER_PAYLOAD_BYTES = 65536
MAX_NODES = 1000
MAX_DEPTH = 12
IDENTIFIER_KINDS = {
    'wallet_id': 'wallet',
    'id_wallet': 'wallet',
    'faas_wallet_identifier': 'wallet',
    'parent_wallet_id': 'wallet',
    'customer_id': 'customer',
    'api_customer_id': 'customer',
    'id_customer': 'customer',
    'business_id': 'business',
    'id_business': 'business',
}
FIELD_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_-]{0,63}$')
OPAQUE_ID = re.compile(
    r'^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-'
    r'[0-9a-fA-F]{12}|(?=.{16,64}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]+)$'
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def _safe_identifier(value):
    return isinstance(value, str) and OPAQUE_ID.fullmatch(value) is not None


def _identifier_kind(key, parent_keys):
    if key in IDENTIFIER_KINDS:
        return IDENTIFIER_KINDS[key]
    if key == 'id':
        if 'wallet' in parent_keys or len(parent_keys) <= 1:
            return 'wallet'
        if 'customer' in parent_keys:
            return 'customer'
        if 'business' in parent_keys:
            return 'business'
    return None


def summarize_response(payload):
    if not isinstance(payload, (dict, list)):
        raise ValueError('provider-json-root')
    field_types = []
    identifiers = []
    relations = []
    provider_payloads = []
    wallet_meta = []
    visited = 0

    def visit(value, path, parent_keys, depth):
        nonlocal visited
        visited += 1
        if visited > MAX_NODES or depth > MAX_DEPTH:
            raise ValueError('provider-shape-bound')
        if isinstance(value, dict):
            direct = {}
            for raw_key, item in value.items():
                key = raw_key if isinstance(raw_key, str) and FIELD_NAME.fullmatch(raw_key) else '<field>'
                item_path = f'{path}.{key}' if path else key
                item_type = _json_type(item)
                field_types.append({'path': item_path, 'type': item_type})
                kind = _identifier_kind(key, parent_keys)
                if kind and _safe_identifier(item):
                    record = {'path': item_path, 'kind': kind, 'value': item}
                    identifiers.append(record)
                    direct[key] = item
                elif (item_path == 'data.provider_payload<json>.eventData.identifier'
                      and _safe_identifier(item)):
                    identifiers.append({
                        'path': item_path,
                        'kind': 'provider_wallet_identity',
                        'value': item,
                    })
                elif key == 'third_party_identifier' and isinstance(item, str):
                    identifiers.append({
                        'path': item_path,
                        'kind': 'third_party_identifier',
                        'valueOmitted': True,
                        'sha256': hashlib.sha256(item.encode()).hexdigest(),
                    })
                if key in {'provider_payload', 'wallet_meta'} and isinstance(item, str):
                    payload_bytes = item.encode('utf-8')
                    statuses = provider_payloads if key == 'provider_payload' else wallet_meta
                    if len(payload_bytes) > MAX_PROVIDER_PAYLOAD_BYTES:
                        statuses.append({'path': item_path, 'status': 'size-limit'})
                    else:
                        try:
                            nested_payload = json.loads(payload_bytes)
                        except (ValueError, UnicodeDecodeError):
                            statuses.append({'path': item_path, 'status': 'invalid-json'})
                        else:
                            nested_path = f'{item_path}<json>'
                            container = isinstance(nested_payload, (dict, list))
                            status = 'parsed' if container or key == 'provider_payload' else 'non-container-json'
                            statuses.append({'path': item_path, 'status': status})
                            field_types.append({'path': nested_path, 'type': _json_type(nested_payload)})
                            if container:
                                visit(nested_payload, nested_path, (*parent_keys, key.lower()), depth + 1)
                if isinstance(item, (dict, list)):
                    visit(item, item_path, (*parent_keys, key.lower()), depth + 1)
            customer_alias = next((direct[key] for key in ('customer_id', 'api_customer_id')
                                   if direct.get(key) == API_CUSTOMER_ID), None)
            if customer_alias and direct.get('id_customer') == WEBHOOK_CUSTOMER_ID:
                relations.append({
                    'containerPath': path or '$',
                    'providerCustomerPath': f'{path}.customer_id' if direct.get('customer_id') == customer_alias
                    else f'{path}.api_customer_id',
                    'relationalCustomerPath': f'{path}.id_customer',
                    'sameResponseObject': True,
                })
        elif isinstance(value, list):
            for item in value:
                item_path = f'{path}[]'
                field_types.append({'path': item_path, 'type': _json_type(item)})
                if isinstance(item, (dict, list)):
                    visit(item, item_path, parent_keys, depth + 1)
                else:
                    visited += 1
                    if visited > MAX_NODES:
                        raise ValueError('provider-shape-bound')

    visit(payload, '', (), 0)
    if len(field_types) > MAX_NODES:
        raise ValueError('provider-shape-bound')
    return {
        'fieldTypes': field_types,
        'identifiers': identifiers,
        'providerPayloads': provider_payloads,
        'walletMeta': wallet_meta,
        'identityAliasEvidence': {
            'status': 'same-record-link-observed' if relations else 'not-proven-by-wallet-response',
            'relations': relations,
        },
    }


def compare_wallet_customer_aliases(results):
    alias_paths = ('customer_id', 'api_customer_id')
    by_wallet = {}
    for result in results:
        aliases = [identifier for identifier in result.get('identifiers', [])
                   if identifier.get('path', '').rsplit('.', 1)[-1].split('<', 1)[0] in alias_paths
                   and _safe_identifier(identifier.get('value'))]
        by_wallet[result.get('walletProbe')] = aliases
    existing = by_wallet.get('existing', [])
    empty_interest = by_wallet.get('empty_interest_true', [])
    matches = [
        {'existingPath': left['path'], 'emptyInterestPath': right['path'], 'sameIdentifier': True}
        for left in existing for right in empty_interest if left['value'] == right['value']
    ]
    return {
        'status': 'same-api-customer-alias-observed' if matches else 'not-proven-by-wallet-responses',
        'matches': matches,
    }


def _json_type(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, dict):
        return 'object'
    if isinstance(value, list):
        return 'array'
    raise ValueError('provider-json-type')


def wallet_request(wallet_id, api_secret):
    if wallet_id not in {value for _, value in WALLETS}:
        raise ValueError('wallet-allowlist')
    if not isinstance(api_secret, str) or not api_secret:
        raise ValueError('provider-configuration')
    url = f'{PROVIDER_ORIGIN}/api/v1/wallet/{quote(wallet_id, safe="")}'
    return Request(url, headers={
        'Accept': 'application/json',
        'Authorization': f'Bearer {api_secret}',
        'User-Agent': USER_AGENT,
    }, method='GET')


def refusal_report(error):
    return {
        'status': 'provider-wallet-shape-refused',
        'errorType': type(error).__name__,
        'redacted': True,
        'readOnly': True,
        'changesMade': False,
    }


def _load_pinned_provider():
    metadata = PROVIDER_HELPER.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) & 0o077 or metadata.st_size > 1_000_000):
        raise ValueError('provider-helper-metadata')
    source = PROVIDER_HELPER.read_bytes()
    if hashlib.sha256(source).hexdigest() != PROVIDER_HELPER_SHA256:
        raise ValueError('provider-helper-pin')
    name = '_pinned_provider_interest_check'
    module = types.ModuleType(name)
    module.__file__ = str(PROVIDER_HELPER)
    sys.modules[name] = module
    exec(compile(source, str(PROVIDER_HELPER), 'exec'), module.__dict__)
    return module


def run():
    if os.geteuid() != 0:
        raise ValueError('root-required')
    provider = _load_pinned_provider()
    if urlsplit(provider.ORIGIN).scheme != 'https' or provider.ORIGIN.rstrip('/') != PROVIDER_ORIGIN:
        raise ValueError('provider-origin-refused')
    configuration = provider.read_configuration()
    api_secret = configuration.get('apiSecret') if isinstance(configuration, dict) else None
    opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    results = []
    for label, wallet_id in WALLETS:
        request = wallet_request(wallet_id, api_secret)
        try:
            with opener.open(request, timeout=15) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ValueError('provider-response-bound')
                if response.status < 200 or response.status >= 300:
                    raise ValueError('provider-http-refused')
                payload = json.loads(body)
                results.append({'walletProbe': label, 'http': response.status, **summarize_response(payload)})
        except HTTPError as error:
            results.append({'walletProbe': label, 'http': error.code, 'redacted': True})
    print(json.dumps({
        'status': 'provider-wallet-shape-read',
        'readOnly': True,
        'changesMade': False,
        'walletCustomerAliasComparison': compare_wallet_customer_aliases(results),
        'results': results,
    }, sort_keys=True))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps(refusal_report(error), sort_keys=True))
        raise SystemExit(1)
