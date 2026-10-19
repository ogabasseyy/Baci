import hashlib
import json
import os
from pathlib import Path
import ssl
import stat
import types
from datetime import datetime, timezone
from urllib.request import HTTPSHandler, Request, build_opener

from plan_constants import (DEADLINE, MAX_BYTES, OLD_FAAS, OLD_WALLET, ORIGIN,
                            PROVIDER_HELPER, PROVIDER_HELPER_SHA, SCOPE)


def _read_bounded_sealed(path, expected_sha, max_bytes):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1
                or metadata.st_size > max_bytes):
            raise ValueError('sealed-file-metadata')
        raw = stream.read(max_bytes + 1)
    if len(raw) > max_bytes or hashlib.sha256(raw).hexdigest() != expected_sha:
        raise ValueError('sealed-file-pin')
    return raw


def read_sealed(path, expected_sha):
    return _read_bounded_sealed(path, expected_sha, MAX_BYTES)


def _helper():
    path = Path(PROVIDER_HELPER)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid not in (0, 1001)
                or metadata.st_mode & 0o022 or metadata.st_nlink != 1
                or metadata.st_size > MAX_BYTES):
            raise ValueError('provider-helper-metadata')
        source = stream.read(MAX_BYTES + 1)
    if hashlib.sha256(source).hexdigest() != PROVIDER_HELPER_SHA:
        raise ValueError('provider-helper-pin')
    helper = types.ModuleType('_reviewed_staging_helper')
    helper.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), helper.__dict__)
    if helper.ORIGIN != ORIGIN or helper.BUSINESS != SCOPE['businessId']:
        raise ValueError('provider-helper-scope')
    return helper


def read_empty_wallet(request=None):
    if request is None:
        if os.geteuid() != 0:
            raise ValueError('root-required')
        helper = _helper()
        configuration = helper.read_configuration()
        opener = build_opener(helper.NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

        def request(wallet_id):
            outbound = Request(ORIGIN + '/api/v1/wallet/' + wallet_id, method='GET', headers={
                'Authorization': 'Bearer ' + configuration['apiSecret'],
                'User-Agent': 'Baci-Staging-ReadOnly/1.0', 'Accept': 'application/json'})
            with opener.open(outbound, timeout=10) as response:
                raw = response.read(MAX_BYTES + 1)
                if response.status != 200 or len(raw) > MAX_BYTES:
                    raise ValueError('wallet-read-bound')
                payload = json.loads(raw)
                if not isinstance(payload, dict) or payload.get('status') is not True:
                    raise ValueError('wallet-read-status')
                return payload.get('data'), hashlib.sha256(raw).hexdigest()

    response_sha = None
    for wallet_id, faas in ((OLD_WALLET, OLD_FAAS), (SCOPE['publicWalletId'], SCOPE['faasWalletId'])):
        wallet, response_sha = request(wallet_id)
        if (not isinstance(wallet, dict) or wallet.get('id') != wallet_id
                or wallet.get('business_id') != SCOPE['businessId']
                or wallet.get('api_customer_id') != SCOPE['apiCustomerId']
                or wallet.get('faas_wallet_identifier') != faas
                or wallet.get('currency') != 'NGN' or wallet.get('status') != 'active'):
            raise ValueError('wallet-exact-identity')
        if wallet_id == SCOPE['publicWalletId'] and (
                wallet.get('interest_enabled') is not True or type(wallet.get('balance')) is not int
                or wallet['balance'] != 0 or type(wallet.get('withdrawal_count')) is not int
                or not 0 <= wallet['withdrawal_count'] <= 4):
            raise ValueError('wallet-not-empty-enabled')
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    if now >= DEADLINE:
        raise ValueError('deadline')
    return {'scope': dict(SCOPE), 'retrievedAt': now, 'responseSha256': response_sha,
            'balanceKobo': 0, 'interestEnabled': True, 'withdrawalCount': wallet['withdrawal_count']}
