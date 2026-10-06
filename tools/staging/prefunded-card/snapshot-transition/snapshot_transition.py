from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import re

from transition_constants import (BINDING, BINDING_FIELDS, DEFINITIONS, FINANCIAL_FIELDS, FUNCTIONS,
    GOAL, INTENT, MODULES, SEAL, SECURITY_FIELDS, SNAPSHOT_FIELDS, SYSTEM, TABLES, VERIFIER)


def _require(condition, reason):
    if not condition:
        raise ValueError('snapshot_transition_' + reason)


def _stable(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _hex(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def _date(value):
    _require(isinstance(value, str), 'timestamp_missing')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('snapshot_transition_timestamp_invalid') from None
    _require(result.tzinfo is not None and result.utcoffset() is not None, 'timezone_required')
    return result.astimezone(timezone.utc)


def _decode(text):
    _require(isinstance(text, str) and len(text) <= 16_000_000, 'canonical_json_refused')
    def pairs(rows):
        result = dict(rows)
        _require(len(result) == len(rows), 'duplicate_json_key')
        return result
    return json.loads(text, object_pairs_hook=pairs, parse_constant=lambda value:
                      (_ for unused in ()).throw(ValueError('snapshot_transition_nonfinite_json')))


def _rows(value, fields):
    _require(isinstance(value, dict) and set(value) in (
        {'rows', 'canonicalRows'}, {'rows', 'canonicalRows', 'sha256'}), 'row_capture_shape')
    rows, canonical = value['rows'], value['canonicalRows']
    _require(isinstance(rows, list) and isinstance(canonical, list)
             and len(rows) == len(canonical) <= 4096, 'row_capture_incomplete')
    _require(canonical == sorted(canonical), 'row_capture_order')
    for row, text in zip(rows, canonical):
        _require(isinstance(row, dict) and set(row) == fields
                 and _stable(_decode(text)) == _stable(row), 'row_capture_mismatch')
    if 'sha256' in value:
        _require(value['sha256'] == _sha('\n'.join(canonical)), 'row_capture_hash')
    return rows, _sha('\n'.join(canonical))


def _capture(value):
    _require(isinstance(value, dict) and set(value) == {'version', 'capturedAt', 'sources',
        'protected', 'financial', 'financialCanonical', 'bindings', 'snapshots', 'security'}
        and type(value['version']) is int and value['version'] == 1, 'capture_shape')
    captured = _date(value['capturedAt'])
    sources = value['sources']
    _require(isinstance(sources, dict) and set(sources) == {'sealSha256', 'modules'}
             and sources['sealSha256'] == SEAL and isinstance(sources['modules'], dict)
             and set(sources['modules']) == set(MODULES.values()) | {
                'tooling/card-week-renewal/sealed-source.json'}
             and all(_hex(pin) for pin in sources['modules'].values()), 'collector_sources_required')
    protected = value['protected']
    _require(isinstance(protected, dict) and set(protected) == {'systemIdentifier', 'readOnly',
        'protectedFinancialSha256', 'tables'} and protected['systemIdentifier'] == SYSTEM
        and protected['readOnly'] is True, 'protected_identity')
    tables = protected['tables']
    _require(isinstance(tables, dict) and set(tables) == set(TABLES), 'all_21_tables_required')
    for row in tables.values():
        _require(isinstance(row, dict) and set(row) == {'count', 'sha256'}
                 and type(row['count']) is int and row['count'] >= 0 and _hex(row['sha256']), 'table_fingerprint')
    financial = value['financial']
    _require(isinstance(financial, dict) and set(financial) == FINANCIAL_FIELDS
             and _stable(_decode(value['financialCanonical'])) == _stable(financial)
             and protected['protectedFinancialSha256'] == _sha(value['financialCanonical']), 'financial_detail_hash')
    bindings, binding_sha = _rows(value['bindings'], BINDING_FIELDS)
    _require(len(bindings) == 1 and tables['prefunded_card.treasury_bindings'] == {
        'count': 1, 'sha256': binding_sha}, 'sole_binding_required')
    binding = bindings[0]
    _require(_stable(financial['treasuryBinding']) == _stable(binding) and binding['id'] == BINDING
        and binding['currency'] == 'NGN' and binding['enabled'] is True, 'binding_identity')
    for field, expected in (('verified_available_kobo', 10000), ('reserved_kobo', 0), ('consumed_kobo', 0)):
        _require(type(binding[field]) is int and binding[field] == expected, 'treasury_totals_changed')
    identity = financial['treasuryIdentity']
    _require(isinstance(identity, dict) and identity['treasury_binding_id'] == BINDING
             and type(identity['opening_available_kobo']) is int and identity['opening_available_kobo'] == 10000
             and financial['replenishments'] == []
             and tables['prefunded_card.treasury_identities']['count'] == 1
             and tables['prefunded_card.treasury_replenishments']['count'] == 0, 'company_total_cap')
    for field in ('integration_id', 'merchant_id', 'expected_business_id', 'source_wallet_id', 'authorized_login'):
        _require(identity[field] == binding[field] and isinstance(binding[field], str)
                 and binding[field], 'treasury_identity_mismatch')
    _require(isinstance(financial['goal'], dict) and financial['goal']['id'] == GOAL
             and type(financial['goal']['current_amount']) in (int, float)
             and Decimal(str(financial['goal']['current_amount'])) == Decimal('100'), 'old_principal_changed')
    _require(financial['intent']['id'] == INTENT and financial['intent']['phase'] == 'retired_unconfirmed'
             and financial['operation']['id'] == INTENT
             and type(financial['otherIntentCount']) is int and financial['otherIntentCount'] == 0
             and type(financial['otherOperationCount']) is int and financial['otherOperationCount'] == 0
             and tables['prefunded_card.checkout_intents']['count'] == 1
             and tables['prefunded_card.operations']['count'] == 1, 'new_operations_or_history')
    snapshots, unused = _rows(value['snapshots'], SNAPSHOT_FIELDS)
    _require(set(value['snapshots']) == {'rows', 'canonicalRows', 'sha256'}, 'snapshot_inventory_hash_required')
    identities = set()
    sequences = set()
    for row in snapshots:
        key = (row['treasury_binding_id'], row['evidence_id'])
        sequence = (row['treasury_binding_id'], row['sequence_number'])
        _require(isinstance(row['treasury_binding_id'], str) and isinstance(row['evidence_id'], str)
                 and 1 <= len(row['evidence_id'].encode()) <= 128
                 and type(row['sequence_number']) is int and row['sequence_number'] >= 1
                 and type(row['available_kobo']) is int and row['available_kobo'] >= 0
                 and key not in identities and sequence not in sequences, 'snapshot_inventory_invalid')
        _date(row['observed_at'])
        _date(row['verified_at'])
        identities.add(key)
        sequences.add(sequence)
    security = value['security']
    _require(isinstance(security, dict) and set(security) == {'detail', 'canonical', 'sha256'}
             and isinstance(security['detail'], dict) and set(security['detail']) == SECURITY_FIELDS
             and _stable(_decode(security['canonical'])) == _stable(security['detail'])
             and security['sha256'] == _sha(security['canonical']), 'security_capture_hash')
    routines = security['detail']['routines']
    for signature, expected in FUNCTIONS.items():
        _require(isinstance(routines, dict) and signature in routines
                 and routines[signature]['sourceSha256'] == expected
                 and routines[signature]['definitionSha256'] == DEFINITIONS[signature],
                 'actual_function_source_pin')
    return captured, binding, snapshots


def validate(before, after, *, started_at, finished_at, outcome, evidence_id,
             expected_snapshot, seal_manifest):
    _require(isinstance(seal_manifest, bytes) and len(seal_manifest) <= 16_000_000
             and hashlib.sha256(seal_manifest).hexdigest() == SEAL, 'exact_r8_manifest_required')
    manifest = _decode(seal_manifest.decode())
    expected_sources = {'sealSha256': SEAL, 'modules': {relative: manifest['files'][relative]
        for relative in [*MODULES.values(), 'tooling/card-week-renewal/sealed-source.json']}}
    _require(all(_stable(value.get('sources')) == _stable(expected_sources)
                 for value in (before, after) if isinstance(value, dict)), 'r8_collector_source_pins')
    before_time, old_binding, old_rows = _capture(before)
    after_time, new_binding, new_rows = _capture(after)
    start, finish = _date(started_at), _date(finished_at)
    _require(before_time <= start <= finish <= after_time
             and (finish - start).total_seconds() <= 60, 'actual_pass_window')
    _require(outcome in ('recorded', 'duplicate') and isinstance(evidence_id, str)
             and re.fullmatch(r'pvts_[0-9a-f]{64}', evidence_id), 'exact_evidence_required')
    _require(_stable(before['sources']) == _stable(after['sources'])
             and _stable(before['security']) == _stable(after['security']), 'schema_acl_source_drift')
    for table in TABLES:
        if table != 'prefunded_card.treasury_bindings':
            _require(before['protected']['tables'][table] == after['protected']['tables'][table],
                     'nonbinding_table_changed')
    _require(_stable({key: value for key, value in old_binding.items() if key != 'verified_at'})
             == _stable({key: value for key, value in new_binding.items() if key != 'verified_at'}),
             'unauthorized_binding_field')
    financial_before = {**before['financial'], 'treasuryBinding': {
        key: value for key, value in old_binding.items() if key != 'verified_at'}}
    financial_after = {**after['financial'], 'treasuryBinding': {
        key: value for key, value in new_binding.items() if key != 'verified_at'}}
    _require(_stable(financial_before) == _stable(financial_after), 'financial_detail_changed')
    history = {(row['treasury_binding_id'], row['evidence_id']): row for row in old_rows}
    current = {(row['treasury_binding_id'], row['evidence_id']): row for row in new_rows}
    _require(all(key in current and _stable(row) == _stable(current[key])
                 for key, row in history.items()), 'historical_snapshot_changed')
    additions = [row for key, row in current.items() if key not in history]
    _require(len(additions) == (1 if outcome == 'recorded' else 0), 'exact_snapshot_append_required')
    if outcome == 'duplicate':
        _require(all(_stable(before[key]) == _stable(after[key]) for key in before if key != 'capturedAt'),
                 'duplicate_must_be_completely_unchanged')
        _require((BINDING, evidence_id) in history, 'duplicate_evidence_missing')
        row = history[(BINDING, evidence_id)]
    else:
        row = additions[0]
    _require(isinstance(expected_snapshot, dict) and set(expected_snapshot) == SNAPSHOT_FIELDS
             and _stable(expected_snapshot) == _stable(row), 'full_actual_snapshot_proof_required')
    _require(row['treasury_binding_id'] == BINDING and row['available_kobo'] == 10000
             and row['verified_by'] == VERIFIER and row['evidence_id'] == evidence_id
             and row['observed_at'] == new_binding['verified_at'], 'snapshot_binding_evidence_mismatch')
    expected_evidence = 'pvts_' + _sha(json.dumps([BINDING, new_binding['expected_business_id'],
        new_binding['source_wallet_id'], _date(row['observed_at']).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        10000], separators=(',', ':'), ensure_ascii=False))
    _require(evidence_id == expected_evidence, 'snapshot_evidence_identifier_mismatch')
    observed = _date(row['observed_at'])
    _require(observed.microsecond % 1000 == 0, 'snapshot_observation_precision')
    previous = [item for item in old_rows if item['treasury_binding_id'] == BINDING]
    if outcome == 'recorded':
        _require(start <= observed <= finish and observed > _date(old_binding['verified_at'])
                 and all(observed > _date(item['observed_at']) for item in previous)
                 and row['sequence_number'] == max([item['sequence_number'] for item in previous] or [0]) + 1
                 and observed <= _date(row['verified_at']) <= finish, 'new_snapshot_time_sequence')
    else:
        _require(0 <= (finish - observed).total_seconds() <= 30
                 and row['sequence_number'] == max([item['sequence_number'] for item in previous] or [0]),
                 'duplicate_not_current')
    report = {'status': 'authorized-snapshot-transition', 'version': 1, 'sealSha256': SEAL,
        'bindingId': BINDING, 'outcome': outcome, 'evidenceId': evidence_id,
        'startedAt': started_at, 'finishedAt': finished_at, 'allowedBindingFields': ['verified_at'],
        'beforeSha256': _sha(_stable(before)), 'afterSha256': _sha(_stable(after)),
        'securitySha256': before['security']['sha256'], 'baselineAdopted': False}
    return {**report, 'transitionSha256': _sha(_stable(report))}
