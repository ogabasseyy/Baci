import hashlib
import json
import os
from pathlib import Path
import ssl
import stat
import types
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import HTTPSHandler, Request, build_opener

from policy_contract import DEADLINE, SCOPE


HELPER = Path('/home/bassey/baci-interest-confirm-20261001.o5wK6hku/provider_interest_check.py')
HELPER_SHA256 = '900b18bc7b25823a8ea36a663ee856a64eb8d37511502b45a3d5d9659ba365b1'
OLD_WALLET = '01M3CQX27G9687EFSF1TKYMPR9'
TRUE_WALLET = '01M3W0Y93XHJY9RPQ2G75X81WG'
TRANSACTION = 'PVB01M3CR6SZGH4K3GCPEMYKXYJ04'
ORIGIN = 'https://staging.piggyvest.business'
MAX_BYTES = 262144
USER_AGENT = 'Baci-Staging-ReadOnly/1.0'


def _load_helper():
    descriptor = os.open(HELPER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
                or metadata.st_uid not in (0, 1001) or metadata.st_mode & 0o022
                or metadata.st_size > MAX_BYTES):
            raise ValueError('provider-helper-metadata')
        source = stream.read(MAX_BYTES + 1)
    if hashlib.sha256(source).hexdigest() != HELPER_SHA256:
        raise ValueError('provider-helper-pin')
    helper = types.ModuleType('_reviewed_identity_provider_helper')
    helper.__file__ = str(HELPER)
    exec(compile(source, str(HELPER), 'exec'), helper.__dict__)
    if helper.ORIGIN != ORIGIN or helper.BUSINESS != SCOPE['businessId']:
        raise ValueError('provider-helper-scope')
    return helper


def read_provider_identity(request=None, helper=None):
    if request is None:
        if os.geteuid() != 0:
            raise ValueError('provider-root-required')
        helper = _load_helper()
        provider = helper.read_configuration()
        opener = build_opener(helper.NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

        def request(path):
            outbound = Request(ORIGIN + path, method='GET', headers={
                'Authorization': 'Bearer ' + provider['apiSecret'], 'Accept': 'application/json',
                'User-Agent': USER_AGENT})
            with opener.open(outbound, timeout=10) as response:
                raw = response.read(MAX_BYTES + 1)
                if response.status != 200 or len(raw) > MAX_BYTES:
                    raise ValueError('provider-response-bound')
                payload = json.loads(raw)
                if not isinstance(payload, dict) or payload.get('status') is not True:
                    raise ValueError('provider-response-status')
                return payload.get('data'), hashlib.sha256(raw).hexdigest()

    wallets = {}
    for wallet_id in (OLD_WALLET, TRUE_WALLET):
        wallets[wallet_id], _ = request('/api/v1/wallet/' + wallet_id)
    cursor, seen, matches = None, set(), []
    for _ in range(4):
        parameters = {'wallet_id': OLD_WALLET, 'limit': 100, 'collapse_batch': 0}
        if cursor:
            parameters['cursor'] = cursor
        page, page_digest = request('/api/v1/transaction?' + urlencode(parameters))
        rows, cursor = helper.page_rows(page)
        for row in rows:
            if not isinstance(row, dict) or row.get('wallet_id') != OLD_WALLET:
                raise ValueError('transaction-list-wallet')
            if row.get('id') == TRANSACTION:
                if (row.get('status') != 'successful' or row.get('type') != 'credit'
                        or type(row.get('amount')) is not int or row['amount'] != 10000
                        or row.get('category') not in ('bank-inflow', 'bank_transfer_inflow')):
                    raise ValueError('transaction-list-identity-amount')
                matches.append(page_digest)
        if not cursor:
            break
        if cursor in seen:
            raise ValueError('transaction-list-cursor')
        seen.add(cursor)
    else:
        raise ValueError('transaction-list-bound')
    if len(matches) != 1:
        raise ValueError('transaction-list-ambiguous-or-absent')
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    if now >= DEADLINE:
        raise ValueError('provider-deadline')
    return wallets, {'transactionId': TRANSACTION,
                     'status': 'exact_provider_transaction_identity_amount_match',
                     'retrievedAt': now, 'responseSha256': matches[0]}
