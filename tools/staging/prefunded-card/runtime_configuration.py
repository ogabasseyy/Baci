import base64
import binascii
import hashlib
import re

import treasury_owner_contract as owner_contract


PROJECT_LABEL = 'baci-isolated-savings'
DATABASE_NAME = 'postgres'
CUSTOMER_ID = '10000000-0000-4000-8000-000000000002'
MAXIMUM_AMOUNT_KOBO = 10000
ROLE_NAMES = frozenset({
    'prefunded_treasury_operator',
    'prefunded_evidence',
    'prefunded_authorizer',
})
PASSWORD_PATTERN = re.compile(r'^[A-Za-z0-9_-]{64}$')
PLACEHOLDER_PATTERN = re.compile(r'<[^<>]+>')
PEM_CERTIFICATE_PATTERN = re.compile(
    r'-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----', re.DOTALL
)


class Refused(Exception):
    pass


def _refuse():
    raise Refused('Runtime configuration input refused')


def _valid_pem_bundle(value):
    if not isinstance(value, str) or not value.strip():
        return False
    matches = list(PEM_CERTIFICATE_PATTERN.finditer(value))
    if not matches or PEM_CERTIFICATE_PATTERN.sub('', value).strip():
        return False
    for match in matches:
        try:
            decoded = base64.b64decode(re.sub(r'\s+', '', match.group(1)), validate=True)
        except (ValueError, binascii.Error):
            return False
        if not decoded:
            return False
    return True


def _json_value(value, ancestors=None):
    if ancestors is None:
        ancestors = set()
    if isinstance(value, dict):
        identity = id(value)
        if identity in ancestors:
            return False
        ancestors.add(identity)
        try:
            return all(
                isinstance(key, str) and _json_value(item, ancestors)
                for key, item in value.items()
            )
        finally:
            ancestors.remove(identity)
    if isinstance(value, list):
        identity = id(value)
        if identity in ancestors:
            return False
        ancestors.add(identity)
        try:
            return all(_json_value(item, ancestors) for item in value)
        finally:
            ancestors.remove(identity)
    if value is None or isinstance(value, (str, bool, int)):
        return True
    return isinstance(value, float) and value == value and abs(value) != float('inf')


def _replace(value, mapping, used):
    if isinstance(value, dict):
        if any(not isinstance(key, str) or '<' in key or '>' in key for key in value):
            _refuse()
        return {key: _replace(item, mapping, used) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace(item, mapping, used) for item in value]
    if isinstance(value, str):
        placeholders = PLACEHOLDER_PATTERN.findall(value)
        if placeholders:
            if len(placeholders) != 1 or value != placeholders[0] or value not in mapping:
                _refuse()
            used.add(value)
            return mapping[value]
        if '<' in value or '>' in value:
            _refuse()
        return value
    return value


def build_runtime_configuration(
    template,
    certificate_authority_pem,
    piggyvest_secret,
    paystack_secret,
    role_passwords,
):
    if not isinstance(template, dict) or not _json_value(template):
        _refuse()
    if set(template) != {
        'expected', 'origins', 'background', 'publicCheckout', 'recovery',
        'savedCardPublicRuntime', 'receiverReplayRuntime',
    }:
        _refuse()
    if not _valid_pem_bundle(certificate_authority_pem):
        _refuse()
    if (not isinstance(piggyvest_secret, str)
            or not re.fullmatch(r'test_key_[A-Za-z0-9_-]+', piggyvest_secret)):
        _refuse()
    if (not isinstance(paystack_secret, str)
            or not re.fullmatch(r'sk_test_[A-Za-z0-9]+', paystack_secret)):
        _refuse()
    if (not isinstance(role_passwords, dict) or set(role_passwords) != ROLE_NAMES
            or any(not isinstance(password, str) or not PASSWORD_PATTERN.fullmatch(password)
                   for password in role_passwords.values())):
        _refuse()

    ca_sha256 = hashlib.sha256(certificate_authority_pem.encode('utf-8')).hexdigest()
    mapping = {
        '<OWNER-PROVED-FIXED-STAGING-SYSTEM-ID>': owner_contract.SYSTEM,
        '<FIXED-DEADLINE-2026-09-29T15:59:10Z>': owner_contract.DEADLINE,
        '<OWNER-PROVED-DATABASE-NAME>': DATABASE_NAME,
        '<SAME-OWNER-PROVED-DATABASE-NAME>': DATABASE_NAME,
        '<OWNER-PROVED-SUPABASE-PROJECT-ID>': PROJECT_LABEL,
        '<SAME-OWNER-PROVED-SUPABASE-PROJECT-ID>': PROJECT_LABEL,
        '<OWNER-PROVED-TLS-DATABASE-HOST>': owner_contract.HOST,
        '<SAME-OWNER-PROVED-TLS-DATABASE-HOST>': owner_contract.HOST,
        '<OWNER-PROVED-CA-SHA256-LOWERCASE-64-HEX>': ca_sha256,
        '<OWNER-PROVED-INTEGRATION-UUID>': owner_contract.INTEGRATION,
        '<OWNER-PROVED-MERCHANT-UUID>': owner_contract.MERCHANT,
        '<OWNER-PROVED-TREASURY-BINDING-UUID>': owner_contract.TREASURY,
        '<OWNER-PROVED-PIGGYVEST-BUSINESS-ID>': owner_contract.BUSINESS,
        '<OWNER-PROVED-TREASURY-SOURCE-WALLET-ID>': owner_contract.SOURCE,
        '<OWNER-PROVED-CUSTOMER-UUIDS>': CUSTOMER_ID,
        '<OWNER-APPROVED-POSITIVE-STAGING-LIMIT>': MAXIMUM_AMOUNT_KOBO,
        '<OWNER-SUPPLIED-CA-PEM>': certificate_authority_pem,
        '<SAME-OWNER-SUPPLIED-CA-PEM>': certificate_authority_pem,
        '<OWNER-SUPPLIED-PIGGYVEST-STAGING-SECRET>': piggyvest_secret,
        '<SAME-OWNER-SUPPLIED-PIGGYVEST-STAGING-SECRET>': piggyvest_secret,
        '<OWNER-SUPPLIED-STAGING-WEBHOOK-SECRET>': piggyvest_secret,
        '<SAME-OWNER-SUPPLIED-STAGING-WEBHOOK-SECRET>': piggyvest_secret,
        '<OWNER-SUPPLIED-PAYSTACK-TEST-SECRET>': paystack_secret,
        '<SAME-OWNER-SUPPLIED-PAYSTACK-TEST-SECRET>': paystack_secret,
        '<SAME-TREASURY-OPERATOR-PASSWORD>': role_passwords['prefunded_treasury_operator'],
        '<SAME-RESTRICTED-TREASURY-OPERATOR-PASSWORD>': role_passwords['prefunded_treasury_operator'],
        '<SAME-EVIDENCE-LOGIN-PASSWORD>': role_passwords['prefunded_evidence'],
        '<SAME-RESTRICTED-EVIDENCE-LOGIN-PASSWORD>': role_passwords['prefunded_evidence'],
        '<SAME-AUTHORIZER-PASSWORD>': role_passwords['prefunded_authorizer'],
    }
    used = set()
    configuration = _replace(template, mapping, used)
    if used != set(mapping):
        _refuse()
    return configuration
