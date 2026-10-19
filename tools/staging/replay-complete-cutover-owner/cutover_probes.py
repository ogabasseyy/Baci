from collections.abc import Callable
import hashlib
import json
import re


__all__ = ['probe_claim_fence']
_SYSTEM = '7686901100561231906'
_ROLE = 'pvb_staging_worker'
_AUDIENCE = 'pvb-staging-receipts'
_GENERATION = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
_EXPIRY = 1791302350
_PATH = '/rpc/claim_piggyvest_staging_receipts'
_NAMES = ('oldNative', 'oldInterest', 'new')
_SNAPSHOT_FIELDS = {'receiptStateSha256', 'quarantineStateSha256', 'signatureStateSha256',
                    'financialStateSha256', 'principalStateSha256'}


def _require(condition: bool) -> None:
    if not condition:
        raise ValueError('claim_fence_probe_refused')


def _credentials(tokens: object, proofs: object) -> dict[str, str]:
    _require(type(tokens) is dict and set(tokens) == set(_NAMES)
             and type(proofs) is dict and set(proofs) == set(_NAMES))
    result = {}
    for name in _NAMES:
        token = tokens[name]
        proof = proofs[name]
        _require(type(token) is str and 0 < len(token) <= 8192
                 and token.isascii() and all(33 <= ord(character) <= 126 for character in token))
        _require(type(proof) is dict and set(proof) == {'tokenSha256', 'signatureVerified', 'claims'}
                 and proof['signatureVerified'] is True
                 and proof['tokenSha256'] == hashlib.sha256(token.encode('ascii')).hexdigest())
        claims = proof['claims']
        expected = {'role', 'aud', 'iat', 'exp'}
        if name == 'new':
            expected.add('replay_claimant_generation')
        _require(type(claims) is dict and set(claims) == expected
                 and claims['role'] == _ROLE and claims['aud'] == _AUDIENCE
                 and type(claims['exp']) is int and claims['exp'] == _EXPIRY
                 and type(claims['iat']) is int and 0 < claims['exp'] - claims['iat'] <= 604800)
        if name == 'new':
            _require(claims['replay_claimant_generation'] == _GENERATION)
        result[name] = token
    _require(result['new'] not in (result['oldNative'], result['oldInterest']))
    return result


def _snapshot(value: object) -> dict[str, str]:
    _require(type(value) is dict and set(value) == _SNAPSHOT_FIELDS)
    _require(all(type(pin) is str and re.fullmatch('[a-f0-9]{64}', pin) is not None
                 for pin in value.values()))
    return dict(value)


def _unique(entries: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for name, value in entries:
        _require(name not in result)
        result[name] = value
    return result


def _response(value: object, status: int, code: str, message: str) -> None:
    _require(type(value) is dict and set(value) == {'status', 'body'}
             and type(value['status']) is int and value['status'] == status)
    raw = value['body']
    _require(type(raw) in (str, bytes))
    content = raw.encode('utf8') if type(raw) is str else raw
    _require(0 < len(content) <= 8192)
    body = json.loads(content.decode('utf8'), object_pairs_hook=_unique)
    _require(type(body) is dict and set(body) == {'code', 'message', 'details', 'hint'}
             and body['code'] == code and body['message'] == message
             and body['details'] is None and body['hint'] is None)


def _execute(tokens: object, token_proofs: object, physical_identity: object,
             request: Callable[..., object], snapshot: Callable[[], object]) -> dict[str, object]:
    _require(type(physical_identity) is dict and set(physical_identity) == {'verified', 'systemIdentifier'}
             and physical_identity['verified'] is True and physical_identity['systemIdentifier'] == _SYSTEM
             and callable(request) and callable(snapshot))
    credentials = _credentials(tokens, token_proofs)
    before = _snapshot(snapshot())
    failed = False
    records = []
    try:
        for name in _NAMES:
            status, code, message = ((400, '22023', 'Invalid claim bounds') if name == 'new'
                                      else (403, '42501', 'Replay claimant refused'))
            response = request(token=credentials[name], method='POST', path=_PATH,
                               payload={'p_limit': None, 'p_lease_seconds': None})
            _response(response, status, code, message)
            records.append(dict(credential=name, httpStatus=status, postgresCode=code))
    except Exception:
        failed = True
    after = _snapshot(snapshot())
    _require(not failed and before == after)
    return dict(status='claim-fence-probes-passed', receiptSystemId=_SYSTEM,
                protectedSnapshotsUnchanged=True, probes=records)


def probe_claim_fence(*, tokens: object, token_proofs: object, physical_identity: object,
                      request: Callable[..., object], snapshot: Callable[[], object]) -> dict[str, object]:
    """Probe parent-authenticated credentials without supplying valid claim bounds.

    tokens/proofs use oldNative, oldInterest, new. Each proof supplies tokenSha256,
    signatureVerified and actual verified claims; cryptographic verification belongs
    to the parent, not JWT decoding here. physical_identity supplies verified and
    systemIdentifier. request(token=, method=, path=, payload=) returns status/body,
    with raw UTF-8 bytes/text. snapshot() returns the five _SNAPSHOT_FIELDS hashes;
    financial/principal hashes must cover the parent's complete protected state.
    No callback, response, token or snapshot contents enter results or errors.
    """
    try:
        return _execute(tokens, token_proofs, physical_identity, request, snapshot)
    except Exception:
        pass
    raise ValueError('claim_fence_probe_refused') from None
