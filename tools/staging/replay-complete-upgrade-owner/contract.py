from datetime import datetime, timezone
import hashlib
import json
import re


APP_SYSTEM = '7685292944002592802'
RECEIPT_SYSTEM = '7686901100561231906'
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
HOST = 'piggyvest-db.staging.baci.internal'
EXPIRY = 1791302350
DEADLINE = '2026-10-06T15:59:10Z'
GENERATION = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
CONTAINER = 'pvb-staging-replay-prefunded'
NATIVE_ID = '5426aa344490d93dac4f6f777ef31a5ce49ec3f889a8e9cb1e99ae708a4ca111'
COMPETITOR_ID = 'c187f78aa0fd3676b08ef84e8e85192e4437943817b895ed2d5a65e3d884cbef'
PREDECESSOR_SEAL = '42966bb33ae5c84223cb56a4de17da442f8ce22c38f003fbcc447e39e0a85068'
INTEREST_CONFIG_SHA256 = 'e3807cb1ac63d438b2cff39df27fc39549ba662ae9774c670b7c105c6816916b'
PREDECESSOR_FILES = {
    'code/replay-daemon.mjs': '02420ef54fe4061cb676ae01003acf4ed9c9280d22a1b3ca0d05e94bd9fe1457',
    'code/prefunded-replay-bundle.mjs': 'b73f5ed97441b8e1941badc340eefee787c43d300bdf033c46174e4e79bab9c4',
    'config/config.json': '1c1d10c49532ea2a4ee1efa17af24a43619f21d382efa7978562f2e727d9264d',
    'config/prefunded.json': 'a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0'}
FENCE_MANIFEST_SHA256 = '0a2f0610b68ec0565788bf4ad06a4e5f90c2eda63406e9639ef2418f8fcd5e29'
FENCED_BODY_SHA256 = '560ca6e2881f5c6b1b51ef554a7c2abb9dcc1c5fb74f70a32b528fb1144819e3'
TIMER_SHA256 = 'c583c071656690e5008369dbc0b7f69f946437e03b3e03e523bdfdea1bdf1c1d'
STOPPER_SHA256 = 'ba67c9116b4882951d05e1e0d9d1ac7ebbb6fcbba4b969b95f4c829d091cf023'
FACTORY_SCOPE = dict(environment='staging', integrationId=INTEGRATION, businessId=BUSINESS,
                     expectedSystemId=APP_SYSTEM, merchantId='10000000-0000-4000-8000-000000000001',
                     treasuryBindingId='ffffcb16-2e95-5cff-a591-e9cc81cf5f57')
BASE_FIELDS = {'environment', 'appSystemId', 'receiptSystemId', 'receiptKey', 'appToken', 'receiptToken'}
COMPLETE_DAEMON_SHA256 = '20a14582973e49d77f13140854107d386586364c8831a23e203b1967e7223126'
DAEMON_ARTIFACT = dict(
    closureSha256='380150f411cba2c96b57e1ef48607a7b71eafb60bb9def5bc48f80acceb3931b',
    buildManifestSha256='c6d5d12d64fd9de3e18e44b2f83261ef58e1dc940c0c6662724ff28604ec9d2f',
    productionTableSha256='281672df75f45d705ba5eab08c9c135565604e67151c76905c20d6dad07b5b45',
    sourceTableSha256='9b7b6a1f31e32366d8a965858c9977f3bc14b197f8ce01040e4c22b6b3bba392')
PRODUCTION_INPUTS = 47
DAEMON_INPUTS = 207
RUNTIME_IMPORTS_SHA256 = '954d8a3928d36d3ecb71f67fe52f380c1761ee0600d00b57ab45920dce1c8e99'
NATURAL_FINANCIAL_PROOF_AFTER = '2026-10-03T07:45:26.302325Z'


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(content):
    return hashlib.sha256(content).hexdigest()


def serialize(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return sha(serialize(value))


def hex_digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def instant():
    now = datetime.now(timezone.utc)
    require(now.timestamp() < EXPIRY, 'fixed_deadline_expired')
    return now


def private_json(content):
    def unique(entries):
        result = {}
        for name, value in entries:
            require(name not in result, 'private_json_refused')
            result[name] = value
        return result
    try:
        require(type(content) is bytes and 0 < len(content) <= 131072, 'private_json_refused')
        return json.loads(content.decode('utf8'), object_pairs_hook=unique,
                          parse_constant=lambda value: require(False, 'private_json_refused'))
    except (ValueError, TypeError, UnicodeError):
        raise ValueError('private_json_refused') from None
