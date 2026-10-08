import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from runtime_replay_configuration import FIELDS, prepare_replay_configuration
from treasury_owner_contract import Refused as RuntimeRefused
from release_contract import DEADLINE, FACTORY, Refused, digest, _require

DEADLINE_EPOCH = 1791302350
CONFIGURATION_PREDECESSOR = 'a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0'
APPROVED_SCOPE = {'businessId': '01M2381RG34HQJMHQKE7DWDACR', 'environment': 'staging',
    'expectedSystemId': '7685292944002592802',
    'integrationId': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'merchantId': '10000000-0000-4000-8000-000000000001',
    'treasuryBindingId': 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'}


def prepare_configuration(base, factory_configuration, signing_keys, now):
    _require(isinstance(base, dict) and set(base) == FIELDS | {'prefundedReplay'},
             'financial_replay_base_scope_refused')
    _require(base['prefundedReplay'] == {'bundleSha256': FACTORY,
        'configurationSha256': CONFIGURATION_PREDECESSOR}
        and digest(factory_configuration) == CONFIGURATION_PREDECESSOR,
        'financial_replay_configuration_predecessor_refused')
    original = {name: value for name, value in base.items() if name != 'prefundedReplay'}
    try:
        prepared = prepare_replay_configuration(original, signing_keys, original['receiptKey'],
                                                 now=now, deadline=DEADLINE_EPOCH)
    except RuntimeRefused:
        raise Refused('financial_replay_signature_proof_refused') from None
    from release_contract import _json
    configuration = _json(factory_configuration)
    _require(set(configuration) == {'scope', 'evidence', 'database'}
             and set(configuration.get('database', {})) == {'treasury', 'ingestion'},
             'financial_replay_factory_scope_refused')
    _require(configuration['scope'] == APPROVED_SCOPE, 'financial_replay_scope_refused')
    private = factory_configuration
    prepared['prefundedReplay'] = {'bundleSha256': FACTORY, 'configurationSha256': digest(private)}
    return {'config.json': json.dumps(prepared, sort_keys=True, separators=(',', ':')).encode(),
            'prefunded.json': private}
