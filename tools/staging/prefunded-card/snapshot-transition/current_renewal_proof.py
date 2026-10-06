from datetime import datetime, timezone
import hashlib
from pathlib import Path

from current_renewal_capture import (DEADLINE, HELPERS, PHASES, ROLES, SOURCE_MODULES,
                                     CAPTURE_LIMIT, decode_capture, execute, _render, _sources)
from snapshot_transition import _capture, _date, _decode, _hex, _require, _sha, _stable
from transition_constants import MODULES, SEAL, SYSTEM, TABLES, VERIFIER

METADATA = {'bindingHash', 'bindingExpiry', 'roleExpiry', 'rolesHash', 'tableHash', 'protectedHash'}
CAPTURE_FIELDS = {'phase', 'capture', 'materialCanonical', 'metadata', 'executorFingerprint',
                  'roles', 'sourceOrigins'}
CUTOFF = 1791301750


def _history(history):
    commit, rehearsal, candidate = (history[key] for key in ('commit', 'rehearsal', 'candidate'))
    pin = history['sqlSha256']
    _require(_hex(pin) and commit.get('status') == 'applied'
        and commit.get('protectedStateUnchanged') is True
        and commit.get('passwordsPrivilegesMembershipUnchanged') is True
        and commit.get('newPaymentStarted') is False and commit.get('publicMutationsEnabled') is False
        and commit.get('sqlSha256') == candidate.get('databaseSqlSha256') == pin
        and rehearsal.get('databaseSqlSha256') == pin
        and rehearsal.get('status') == 'rollback_rehearsal_passed'
        and rehearsal.get('rollbackConfirmed') is True and rehearsal.get('protectedStateUnchanged') is True,
        'renewal_historical_commit_proof_refused')
    commit, rehearsal = history['bindingCommit'], history['bindingRehearsal']
    _require(_hex(history['bindingSqlSha256']) and commit.get('status') == 'applied'
        and commit.get('sqlSha256') == rehearsal.get('sqlSha256') == history['bindingSqlSha256']
        and commit.get('passwordPrivilegesMembershipUnchanged') is True
        and commit.get('immutableTriggerRestored') is True
        and rehearsal.get('status') == 'rollback_rehearsal_passed' and rehearsal.get('triggerRestored') is True,
        'renewal_historical_snapshot_commit_refused')
    before = history['bindingBefore']
    meta = before['metadata']
    _require(before.get('systemIdentifier') == SYSTEM and before.get('readOnly') is True
        and isinstance(meta, dict) and set(meta) == METADATA
        and all(_hex(meta[key]) for key in ('bindingHash', 'rolesHash', 'tableHash', 'protectedHash'))
        and all(meta[key] in ('2026-09-29T15:59:10Z', DEADLINE) for key in ('bindingExpiry', 'roleExpiry'))
        and _hex(history['rolesBefore']), 'renewal_historical_baseline_refused')
    return meta


def _material(value, *, sources, origins, phase):
    _require(isinstance(value, dict) and set(value) == CAPTURE_FIELDS and value['phase'] == phase,
             'renewal_capture_shape_or_phase')
    _require(_stable(value['sourceOrigins']) == _stable(origins)
             and _stable(value['capture']['sources']) == _stable(sources), 'renewal_actual_source_provenance')
    captured, binding, snapshots = _capture(value['capture'])
    canonical = value['materialCanonical']
    material = _decode(canonical)
    _require(isinstance(material, dict) and set(material) == {'financial', 'tables'}
        and _stable(material['financial']) == _stable(value['capture']['financial'])
        and _stable(material['tables']) == _stable(value['capture']['protected']['tables']),
        'renewal_complete_material_mismatch')
    metadata = value['metadata']
    _require(isinstance(metadata, dict) and set(metadata) == METADATA
        and metadata['protectedHash'] == _sha(canonical), 'renewal_current_material_hash')
    verified = _date(binding['verified_at'])
    rows = [row for row in snapshots if row['treasury_binding_id'] == binding['id']]
    _require(rows and verified <= captured, 'renewal_snapshot_future_or_missing')
    latest = max(rows, key=lambda row: row['sequence_number'])
    _require(_date(latest['observed_at']) == verified and latest['available_kobo'] == 10000
        and latest['verified_by'] == VERIFIER and verified <= _date(latest['verified_at']) <= captured
        and all(_date(row['observed_at']) <= captured and _date(row['verified_at']) <= captured
                for row in snapshots), 'renewal_snapshot_current_binding_mismatch')
    _require(isinstance(value['roles'], dict) and set(value['roles']) == set(ROLES)
        and all(_stable(row) == _stable({'expiresAt': DEADLINE, 'unsafe': False})
                for row in value['roles'].values()), 'renewal_actual_role_safety_refused')
    return captured, _sha(canonical)


def _validate(current, approved_raw, approved_sha256, history, *, phase,
              started_at, finished_at, seal_manifest, origins):
    _require(phase in PHASES and isinstance(approved_raw, bytes) and len(approved_raw) <= CAPTURE_LIMIT
        and _hex(approved_sha256) and hashlib.sha256(approved_raw).hexdigest() == approved_sha256,
        'renewal_parent_approved_capture_pin_required')
    _require(isinstance(seal_manifest, bytes) and len(seal_manifest) <= 16_000_000
        and hashlib.sha256(seal_manifest).hexdigest() == SEAL, 'renewal_exact_r8_manifest_required')
    manifest = _decode(seal_manifest.decode())
    sources = {'sealSha256': SEAL, 'modules': {relative: manifest['files'][relative]
        for relative in [*MODULES.values(), 'tooling/card-week-renewal/sealed-source.json']}}
    _require(origins['sealSha256'] == SEAL and set(origins['helpers']) == set(HELPERS)
        and all(_hex(pin) for pin in origins['helpers'].values()), 'renewal_reviewed_collector_required')
    for relative, entry in origins['modules'].items():
        _require(entry == {'path': str(Path(origins['bundleRoot']) / relative),
            'sha256': manifest['files'][relative]}, 'renewal_collector_origin_pin')
    _require(set(SOURCE_MODULES.values()) <= set(origins['modules']), 'renewal_collector_closure_required')
    historical = _history(history)
    approved = decode_capture(approved_raw.decode())
    approved_time, approved_hash = _material(approved, sources=sources, origins=origins, phase=phase)
    observed_time, current_hash = _material(current, sources=sources, origins=origins, phase=phase)
    start, finish = _date(started_at), _date(finished_at)
    _require(approved_time <= start <= observed_time <= finish
        and 0 <= (start - approved_time).total_seconds() <= 60
        and 0 <= (finish - start).total_seconds() <= 60 and finish.timestamp() < CUTOFF,
        'renewal_actual_phase_capture_stale_or_expired')
    for value in (approved, current):
        expected = {**historical, 'bindingExpiry': DEADLINE, 'roleExpiry': DEADLINE,
                    'protectedHash': _sha(value['materialCanonical'])}
        _require(_stable(value['metadata']) == _stable(expected), 'renewal_binding_acl_roles_trigger_drift')
        _require(value['executorFingerprint'] == history['rolesBefore'], 'renewal_executor_fingerprint_changed')
    _require(approved_hash == current_hash
        and all(_stable(approved[key]) == _stable(current[key]) for key in CAPTURE_FIELDS - {'capture'})
        and all(_stable(approved['capture'][key]) == _stable(current['capture'][key])
                for key in approved['capture'] if key != 'capturedAt'), 'renewal_approved_full_current_state_drift')
    result = {'roles': {name: {**row, 'passwordUnchanged': True, 'privilegesUnchanged': True,
                             'membershipUnchanged': True} for name, row in current['roles'].items()},
        'snapshotBinding': {'expiresAt': DEADLINE, 'identityUnchanged': True, 'immutableTriggerRestored': True},
        'guardedRenewalCommitted': True, 'rollbackRehearsalBoundToSql': True,
        'constraintsAndHistoryPreserved': True}
    receipt = {'version': 1, 'status': 'parent-approved-current-renewal-phase-proved', 'phase': phase,
        'sealSha256': SEAL, 'startedAt': started_at, 'finishedAt': finished_at,
        'approvedCaptureSha256': approved_sha256, 'currentCaptureSha256': _sha(_stable(current)),
        'historicalProtectedHash': historical['protectedHash'], 'currentProtectedHash': current_hash,
        'historicalRecordsSha256': _sha(_stable(history)), 'sourceOrigins': origins,
        'baselineAdopted': False, 'historicalRenewalAssertionRewritten': False}
    return result, {**receipt, 'receiptSha256': _sha(_stable(receipt))}


def _read(modules, path, limit=16_000_000):
    io = modules['treasury_owner_io']
    io.root_ancestors(path)
    io.private_directory(path.parent)
    return io.read_file(path, 0, 0o600, limit)


def prove(audit, bundle, approved_capture, approved_sha256, *, phase, helper_pins,
          query=None, with_receipt=False):
    _require(phase in PHASES and type(with_receipt) is bool, 'renewal_entrypoint_scope_refused')
    modules, manifest, origins = _sources(bundle, helper_pins)
    actual_query = modules['owner_database'].database
    _require(query is None or query is actual_query, 'renewal_source_bound_actual_query_required')
    audit = Path(audit)
    approved_raw = _read(modules, Path(approved_capture), CAPTURE_LIMIT)
    _require(_hex(approved_sha256) and hashlib.sha256(approved_raw).hexdigest() == approved_sha256,
             'renewal_parent_approved_capture_pin_required')
    paths = {'commit': 'commit-result.json', 'rehearsal': 'rehearsal-result.json',
        'candidate': 'renewal-candidate/candidate.json', 'bindingBefore': 'snapshot-baseline.json',
        'bindingCommit': 'snapshot-commit-result.json', 'bindingRehearsal': 'snapshot-rehearsal-result.json'}
    history = {key: _decode(_read(modules, audit / relative).decode()) for key, relative in paths.items()}
    history['sqlSha256'] = hashlib.sha256(_read(modules, audit / 'renewal-candidate/database-renewal.sql')).hexdigest()
    history['bindingSqlSha256'] = hashlib.sha256(_read(modules, audit / 'snapshot-candidate/commit.sql')).hexdigest()
    history['rolesBefore'] = _read(modules, audit / 'roles-before-sha256.txt', 128).decode().strip()
    _history(history)
    statement = _render(bundle, phase, modules, origins)
    started = datetime.now(timezone.utc).isoformat()
    _require(_date(started).timestamp() < CUTOFF, 'renewal_phase_expired')
    current_raw = (actual_query(statement) if query is not None
        else execute(bundle, phase=phase, helper_pins=helper_pins))
    finished = datetime.now(timezone.utc).isoformat()
    result, receipt = _validate(decode_capture(current_raw), approved_raw, approved_sha256, history,
        phase=phase, started_at=started, finished_at=finished, seal_manifest=manifest, origins=origins)
    modules['treasury_owner_io'].root_ancestors(Path(approved_capture))
    _require(_read(modules, Path(approved_capture), CAPTURE_LIMIT) == approved_raw,
        'renewal_approval_changed_during_proof')
    _sources(bundle, helper_pins)
    return (result, receipt) if with_receipt else result
