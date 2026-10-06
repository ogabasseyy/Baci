import hashlib
import re

from renewal_contract import (
    BINDING, FUNDING_ENV, GATEWAY_TARGET, GATES, PINS, PROTECTED_CONTAINERS,
    PROTECTED_SERVICES, PROTECTED_TIMERS, RECEIPT_SYSTEM, SYSTEM, TARGET,
    TARGET_EPOCH, UNIT_DIRECTORY, Refused, candidates as expected_candidates,
    canonical, digest, parse_json,
)


OWNER_RECEIPT_SHA256 = '152cca796e433b5f1067333a95122a1ad9f50d61697d7935ea11b32931592ace'
RECEIPT_FIELDS = {
    'version', 'stage', 'status', 'activationReady', 'renewalApplied', 'liveChangesMade',
    'newPaymentStarted', 'databaseApplied', 'requestedServiceDeadline',
    'requestedGatewayDeadline', 'preparedAtEpochMs', 'startupEvidenceGenerated',
    'sources', 'candidateSha256', 'identitySha256', 'routesSha256', 'inventorySha256',
    'invariants', 'observedStates', 'activationRefusals',
}
SOURCE_FIELDS = {'path', 'sha256', 'backup', 'uid', 'gid', 'mode', 'size', 'nlink'}
INVARIANT_FIELDS = {
    'physicalSystems', 'principalKobo', 'treasuryReservedKobo', 'treasuryConsumedKobo',
    'treasuryApprovedKobo', 'oldIntentRetained', 'replayJwtExpiryUnverified',
    'replayJwtCoversTargetUnverified',
}


def _refuse(condition):
    if condition:
        raise Refused('preparation-record-invalid')


def _hash(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def _check_invariants(value):
    _refuse(not isinstance(value, dict) or set(value) != INVARIANT_FIELDS)
    _refuse(value['physicalSystems'] != [SYSTEM, RECEIPT_SYSTEM])
    _refuse(type(value['principalKobo']) is not int or value['principalKobo'] != 10000)
    _refuse(type(value['treasuryApprovedKobo']) is not int or value['treasuryApprovedKobo'] != 10000)
    _refuse(type(value['treasuryReservedKobo']) is not int or value['treasuryReservedKobo'] != 0)
    _refuse(type(value['treasuryConsumedKobo']) is not int or value['treasuryConsumedKobo'] != 0)
    _refuse(value['oldIntentRetained'] is not True)
    expiries = value['replayJwtExpiryUnverified']
    _refuse(not isinstance(expiries, list) or any(type(item) is not int or item <= 0 for item in expiries))
    _refuse(expiries != sorted(set(expiries)))
    covers_target = bool(expiries) and min(expiries) > TARGET_EPOCH
    _refuse(value['replayJwtCoversTargetUnverified'] is not covers_target)


def _source_names():
    return {f'{index:02d}-{path.rsplit("/", 1)[-1]}': path
            for index, path in enumerate(PINS)}


def _check_states(states):
    unit_names = {path.rsplit('/', 1)[-1] for path in PINS if path.startswith(UNIT_DIRECTORY)}
    unit_names.update(PROTECTED_SERVICES)
    unit_names.update(PROTECTED_TIMERS)
    expected_names = unit_names | set(PROTECTED_CONTAINERS)
    _refuse(not isinstance(states, dict) or set(states) != expected_names)
    stopped = set(PROTECTED_SERVICES) | set(PROTECTED_TIMERS) | {
        'baci-savings-gateway.service', 'baci-savings-drafts.service',
    }
    for name in unit_names:
        value = states[name]
        fields = {'LoadState', 'ActiveState', 'SubState', 'FragmentPath', 'DropInPaths',
                  'NeedDaemonReload', 'UnitFileState'}
        if name.endswith('.service'):
            fields.add('MainPID')
        _refuse(not isinstance(value, dict) or set(value) != fields
                or any(not isinstance(item, str) for item in value.values())
                or value['LoadState'] != 'loaded'
                or value['FragmentPath'] != UNIT_DIRECTORY + name
                or value['DropInPaths'] != '' or value['NeedDaemonReload'] != 'no'
                or value['UnitFileState'] not in ('static', 'enabled', 'disabled'))
        if name.endswith('.service'):
            _refuse(not isinstance(value['MainPID'], str) or not value['MainPID'].isdigit())
        if name in stopped:
            _refuse(value['ActiveState'] not in ('inactive', 'failed'))
            if name.endswith('.service'):
                _refuse(value['MainPID'] != '0')
    for name in PROTECTED_CONTAINERS:
        _refuse(states[name] != {'running': False, 'restarting': False, 'restartPolicy': 'no'})


def _check_sources(records, originals):
    names = _source_names()
    _refuse(not isinstance(originals, dict) or set(originals) != set(names))
    _refuse(not isinstance(records, list) or len(records) != len(PINS))
    seen = set()
    contents = {}
    for record in records:
        _refuse(not isinstance(record, dict) or set(record) != SOURCE_FIELDS)
        path = record['path']
        _refuse(path not in PINS or path in seen)
        seen.add(path)
        name = record['backup']
        _refuse(name != next(key for key, source in names.items() if source == path))
        content = originals.get(name)
        _refuse(not isinstance(content, bytes) or digest(content) != PINS[path]
                or record['sha256'] != PINS[path] or type(record['size']) is not int
                or record['size'] != len(content) or type(record['uid']) is not int
                or record['uid'] != 0 or type(record['gid']) is not int or record['gid'] < 0
                or type(record['nlink']) is not int or record['nlink'] != 1)
        expected_modes = {'0644'} if path.startswith(UNIT_DIRECTORY) else {'0440'}
        if path == FUNDING_ENV:
            expected_modes = {'0400', '0600', '0440', '0640'}
        _refuse(record['mode'] not in expected_modes)
        contents[path] = content
    _refuse(seen != set(PINS))
    return contents


def validate_preparation(receipt_bytes, originals, candidate_files,
                         expected_sha256=OWNER_RECEIPT_SHA256):
    _refuse(not isinstance(receipt_bytes, bytes) or not _hash(expected_sha256))
    receipt_sha256 = hashlib.sha256(receipt_bytes).hexdigest()
    _refuse(receipt_sha256 != expected_sha256)
    receipt = parse_json(receipt_bytes)
    _refuse(not isinstance(receipt, dict) or set(receipt) != RECEIPT_FIELDS)
    _refuse(type(receipt['version']) is not int or receipt['version'] != 1
            or receipt['stage'] != 'lane-a-preparation'
            or receipt['status'] != 'prepared-review-required')
    for field in ('activationReady', 'renewalApplied', 'liveChangesMade', 'newPaymentStarted',
                  'databaseApplied', 'startupEvidenceGenerated'):
        _refuse(receipt[field] is not False)
    _refuse(receipt['requestedServiceDeadline'] != TARGET
            or receipt['requestedGatewayDeadline'] != GATEWAY_TARGET
            or type(receipt['preparedAtEpochMs']) is not int
            or receipt['preparedAtEpochMs'] <= 0)
    contents = _check_sources(receipt['sources'], originals)
    binding = parse_json(contents[BINDING])
    _refuse(receipt['identitySha256'] != digest(canonical(binding['identity']))
            or receipt['routesSha256'] != digest(canonical(binding['identity']['restRoutes']))
            or not _hash(receipt['inventorySha256']))
    if not isinstance(candidate_files, dict) or any(not isinstance(item, bytes) for item in candidate_files.values()):
        raise Refused('preparation-record-invalid')
    expected = expected_candidates(contents, receipt['preparedAtEpochMs'])
    _refuse(candidate_files != expected)
    hashes = {name: digest(content) for name, content in expected.items()}
    _refuse(receipt['candidateSha256'] != hashes)
    _check_invariants(receipt['invariants'])
    _refuse(receipt['activationRefusals'] != list(GATES))
    _check_states(receipt['observedStates'])
    return {
        'stage': 'lane-a-preparation', 'status': 'prepared-review-required',
        'receiptSha256': receipt_sha256, 'preparedAtEpochMs': receipt['preparedAtEpochMs'],
        'requestedServiceDeadline': TARGET, 'requestedGatewayDeadline': GATEWAY_TARGET,
        'sourceCount': len(PINS), 'candidateCount': len(expected),
        'principalKobo': 10000, 'treasuryApprovedKobo': 10000,
        'treasuryReservedKobo': 0, 'treasuryConsumedKobo': 0,
        'oldIntentRetained': True, 'activationReady': False,
        'renewalApplied': False, 'liveChangesMade': False, 'newPaymentStarted': False,
    }
