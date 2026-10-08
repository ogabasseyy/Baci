from datetime import datetime, timezone
import json
import re


SYSTEM_IDENTIFIER = '7685292944002592802'
RECEIPT_SYSTEM_IDENTIFIER = '7686901100561231906'
DEADLINE_EPOCH = 1790697550
PRINCIPAL_KOBO = 10000
MAX_PROOF_AGE_SECONDS = 15 * 60
SHA_RE = re.compile(r'^[a-f0-9]{64}$')
EXPECTED_SCOPE = {
    'systemIdentifier': SYSTEM_IDENTIFIER,
    'integrationId': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'businessId': '01M2381RG34HQJMHQKE7DWDACR',
    'merchantId': '10000000-0000-4000-8000-000000000001',
    'customerId': '10000000-0000-4000-8000-000000000002',
    'goalId': '430314fd-cd8b-4579-98d4-e9f345713dd6',
    'providerWalletId': '01M3CQX27G9687EFSF1TKYMPR9',
    'providerCustomerId': 'c096507d-dc32-45d2-9c01-871a27abfd10',
    'currency': 'NGN',
}


class InvalidProof(Exception):
    pass


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise InvalidProof()
            result[key] = value
        return result

    try:
        return json.loads(data.decode('utf-8'), object_pairs_hook=pairs)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise InvalidProof() from None


def parse_manifest(value, container, database, system_identifier, deadline,
                   candidate_name, max_files, file_pattern, sha_pattern):
    if not isinstance(value, dict) or set(value) != {
        'schemaVersion', 'container', 'database', 'systemIdentifier', 'deadline', 'files'
    }:
        raise InvalidProof()
    files = value['files']
    if (
        type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
        or value['container'] != container
        or value['database'] != database or value['systemIdentifier'] != system_identifier
        or value['deadline'] != deadline or not isinstance(files, dict)
        or candidate_name not in files or not 1 < len(files) <= max_files
    ):
        raise InvalidProof()
    if any(
        not isinstance(name, str) or not file_pattern.fullmatch(name)
        or not isinstance(digest, str) or not sha_pattern.fullmatch(digest)
        for name, digest in files.items()
    ):
        raise InvalidProof()
    return files


def _timestamp(value):
    if not isinstance(value, str):
        raise InvalidProof()
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise InvalidProof() from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InvalidProof()
    return parsed.astimezone(timezone.utc)


def validate_proof(report, now=None):
    if not isinstance(report, dict) or 'ownerSealed' not in report:
        raise InvalidProof()
    if report.get('changesMade') is not False:
        raise InvalidProof()
    if report.get('receiptSystemIdentifier') != RECEIPT_SYSTEM_IDENTIFIER:
        raise InvalidProof()
    for key, expected in EXPECTED_SCOPE.items():
        outer_key = {
            'systemIdentifier': 'appSystemIdentifier',
            'integrationId': 'integrationId',
            'businessId': 'businessId',
            'merchantId': 'merchantId',
            'customerId': 'customerId',
            'goalId': 'goalId',
            'providerWalletId': 'providerWalletId',
            'providerCustomerId': 'providerCustomerId',
        }.get(key)
        if outer_key and report.get(outer_key) != expected:
            raise InvalidProof()
    if report.get('principalKobo') != PRINCIPAL_KOBO:
        raise InvalidProof()
    proof = report['ownerSealed']
    if not isinstance(proof, dict) or set(proof) != {
        'schemaVersion', 'verifiedAt', 'scope', 'credits'
    }:
        raise InvalidProof()
    if type(proof['schemaVersion']) is not int or proof['schemaVersion'] != 1:
        raise InvalidProof()
    if proof['scope'] != EXPECTED_SCOPE:
        raise InvalidProof()
    current = now or datetime.now(timezone.utc)
    verified = _timestamp(proof['verifiedAt'])
    age = (current.astimezone(timezone.utc) - verified).total_seconds()
    if age < 0 or age > MAX_PROOF_AGE_SECONDS:
        raise InvalidProof()
    if current.astimezone(timezone.utc) >= datetime.fromtimestamp(
        DEADLINE_EPOCH, timezone.utc
    ):
        raise InvalidProof()
    credits = proof['credits']
    if not isinstance(credits, list) or not 0 < len(credits) <= 100:
        raise InvalidProof()
    if (
        not isinstance(report.get('history'), list)
        or not isinstance(report.get('proofs'), list)
        or len(report['history']) != len(credits)
        or len(report['proofs']) != len(credits)
    ):
        raise InvalidProof()
    amount_total = 0
    required = {
        'receiptId', 'payloadSha256', 'originalPayloadIntegrity', 'provenance',
        'signatureStatus', 'providerReconciliation', 'legacyProviderTransactionId',
        'contributionId', 'observation',
    }
    for credit in credits:
        if not isinstance(credit, dict) or set(credit) != required:
            raise InvalidProof()
        signature = {
            'signed_receipt': 'verified',
            'provider_reconciliation': 'unavailable',
        }.get(credit['provenance'])
        observation = credit['observation']
        if (
            signature is None or credit['signatureStatus'] != signature
            or credit['originalPayloadIntegrity'] != 'aead_authenticated'
            or not isinstance(observation, dict)
        ):
            raise InvalidProof()
        amount = observation.get('amountKobo')
        if (
            type(amount) is not int or amount <= 0
            or observation.get('currency') != 'NGN'
            or observation.get('status') != 'verified'
            or observation.get('kind') != 'bank_inflow'
        ):
            raise InvalidProof()
        reconciliation = credit['providerReconciliation']
        if not isinstance(reconciliation, dict) or set(reconciliation) != {
            'transactionId', 'responseSha256', 'retrievedAt'
        }:
            raise InvalidProof()
        if (
            reconciliation['transactionId'] != observation.get('providerTransactionId')
            or not isinstance(reconciliation['responseSha256'], str)
            or not SHA_RE.fullmatch(reconciliation['responseSha256'])
        ):
            raise InvalidProof()
        retrieved = _timestamp(reconciliation['retrievedAt'])
        if retrieved > verified or (verified - retrieved).total_seconds() > MAX_PROOF_AGE_SECONDS:
            raise InvalidProof()
        amount_total += amount
    if amount_total != PRINCIPAL_KOBO:
        raise InvalidProof()
    return proof


def run_mode(check, sql, proof_digest, runner):
    if check:
        return {
            'status': 'local-inputs-checked', 'databaseContacted': False,
            'changesMade': False, 'proofSha256': proof_digest,
        }
    outcome = runner(sql)
    if outcome is None or (
        isinstance(outcome, dict) and outcome.get('changesMade') is None
    ):
        result = {
            'status': 'apply-unconfirmed', 'changesMade': None,
            'proofSha256': proof_digest,
        }
        if isinstance(outcome, dict) and isinstance(outcome.get('diagnostic'), dict):
            result['diagnostic'] = outcome['diagnostic']
        return result
    return {
        'status': 'applied' if outcome else 'already-complete',
        'changesMade': outcome, 'proofSha256': proof_digest,
    }
