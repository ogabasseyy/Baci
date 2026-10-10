import copy

from snapshot_transition import _decode, _require, _sha, _stable, validate


def admit(current, approved, *, phase, transition=None, seal_manifest=None):
    _require(phase in ('prestart', 'preschedule', 'public-mutation')
        and current['phase'] == phase and approved['phase'] == 'prestart',
        'parent_phase_admission_scope')
    expected = copy.deepcopy(approved['capture'])
    if phase != 'prestart':
        _require(isinstance(transition, dict), 'parent_authorized_transition_required')
        before, after, receipt = (transition[key] for key in ('before', 'after', 'receipt'))
        _require(_stable({key: value for key, value in before.items() if key != 'capturedAt'})
            == _stable({key: value for key, value in expected.items() if key != 'capturedAt'}),
            'parent_transition_prior_state_drift')
        actual = validate(before, after, started_at=receipt['startedAt'],
            finished_at=receipt['finishedAt'], outcome=receipt['outcome'],
            evidence_id=receipt['evidenceId'], expected_snapshot=transition['snapshot'],
            seal_manifest=seal_manifest)
        _require(_stable(actual) == _stable(receipt), 'parent_transition_receipt_drift')
        expected = after
    _require(_stable({key: value for key, value in current['capture'].items() if key != 'capturedAt'})
        == _stable({key: value for key, value in expected.items() if key != 'capturedAt'}),
        'parent_full_phase_state_drift')
    for key in ('executorFingerprint', 'roles', 'sourceOrigins'):
        _require(_stable(current[key]) == _stable(approved[key]), 'parent_phase_identity_drift')
    material = _decode(current['materialCanonical'])
    _require(_stable(material) == _stable({'financial': expected['financial'],
        'tables': expected['protected']['tables']})
        and current['metadata']['protectedHash'] == _sha(current['materialCanonical']),
        'parent_full_material_drift')
    _require(_stable({key: value for key, value in current['metadata'].items() if key != 'protectedHash'})
        == _stable({key: value for key, value in approved['metadata'].items() if key != 'protectedHash'}),
        'parent_phase_security_binding_drift')
    if phase == 'prestart':
        _require(current['materialCanonical'] == approved['materialCanonical'],
            'parent_original_material_drift')
    return current
