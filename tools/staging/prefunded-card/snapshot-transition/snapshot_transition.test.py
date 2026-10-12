import copy
import hashlib
import json
import unittest
from unittest.mock import patch

import snapshot_transition as transition
from transition_constants import (BINDING, DEFINITIONS, FUNCTIONS, GOAL, INTENT, MODULES,
                                 SECURITY_FIELDS, TABLES, VERIFIER)

START = '2026-10-02T15:00:01Z'
FINISH = '2026-10-02T15:00:03Z'
OLD = '2026-10-02T14:59:58.000+00:00'
NEW = '2026-10-02T15:00:02.123+00:00'
MANIFEST = json.dumps({'files': {relative: 'b' * 64 for relative in
    [*MODULES.values(), 'tooling/card-week-renewal/sealed-source.json']}}).encode()
SEAL = hashlib.sha256(MANIFEST).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def evidence(observed):
    date = transition._date(observed).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return 'pvts_' + sha(json.dumps([BINDING, 'business', 'wallet', date, 10000], separators=(',', ':')))


def refresh(value):
    value['financialCanonical'] = canonical(value['financial'])
    value['protected']['protectedFinancialSha256'] = sha(value['financialCanonical'])
    for field in ('bindings', 'snapshots'):
        rows = sorted(value[field]['rows'], key=canonical)
        value[field]['rows'] = rows
        value[field]['canonicalRows'] = [canonical(row) for row in rows]
        digest = sha('\n'.join(value[field]['canonicalRows']))
        if field == 'bindings':
            value['protected']['tables']['prefunded_card.treasury_bindings'] = {'count': len(rows), 'sha256': digest}
        else:
            value[field]['sha256'] = digest
    value['security']['canonical'] = canonical(value['security']['detail'])
    value['security']['sha256'] = sha(value['security']['canonical'])
    return value


def capture():
    binding = {'id': BINDING, 'integration_id': 'integration', 'merchant_id': 'merchant',
        'expected_business_id': 'business', 'source_wallet_id': 'wallet', 'currency': 'NGN',
        'verified_available_kobo': 10000, 'reserved_kobo': 0, 'consumed_kobo': 0,
        'verified_at': OLD, 'authorized_login': 'worker', 'enabled': True}
    identity = {field: binding[field] for field in ('integration_id', 'merchant_id',
        'expected_business_id', 'source_wallet_id', 'authorized_login')}
    identity.update(treasury_binding_id=BINDING, opening_available_kobo=10000)
    tables = {table: {'count': 0, 'sha256': 'a' * 64} for table in TABLES}
    for table in ('prefunded_card.checkout_intents', 'prefunded_card.operations',
                  'prefunded_card.treasury_identities'):
        tables[table]['count'] = 1
    security = {field: [] for field in SECURITY_FIELDS}
    security['relations'] = [{'name': 'treasury_bindings', 'rls': True}]
    security['routines'] = {signature: {'sourceSha256': digest,
        'definitionSha256': DEFINITIONS[signature], 'acl': 'unchanged'}
                            for signature, digest in FUNCTIONS.items()}
    return refresh({'version': 1, 'capturedAt': '2026-10-02T15:00:00Z',
        'sources': {'sealSha256': SEAL, 'modules': {relative: 'b' * 64 for relative in
            [*MODULES.values(), 'tooling/card-week-renewal/sealed-source.json']}},
        'protected': {'systemIdentifier': transition.SYSTEM, 'readOnly': True, 'tables': tables},
        'financial': {'goal': {'id': GOAL, 'current_amount': 100, 'metadata': {'old': True}},
            'intent': {'id': INTENT, 'phase': 'retired_unconfirmed'},
            'operation': {'id': INTENT, 'amount': 10000}, 'retirementAudits': [{'old': True}],
            'treasuryBinding': binding, 'treasuryIdentity': identity, 'replenishments': [],
            'otherIntentCount': 0, 'otherOperationCount': 0},
        'bindings': {'rows': [binding]}, 'snapshots': {'rows': [{
            'treasury_binding_id': BINDING, 'evidence_id': evidence(OLD), 'sequence_number': 7,
            'observed_at': OLD, 'available_kobo': 10000, 'verified_by': VERIFIER, 'verified_at': OLD}]},
        'security': {'detail': security}})


def pair():
    before = capture()
    after = copy.deepcopy(before)
    after['capturedAt'] = '2026-10-02T15:00:04Z'
    after['bindings']['rows'][0]['verified_at'] = NEW
    after['snapshots']['rows'].append({'treasury_binding_id': BINDING, 'evidence_id': evidence(NEW),
        'sequence_number': 8, 'observed_at': NEW, 'available_kobo': 10000,
        'verified_by': VERIFIER, 'verified_at': '2026-10-02T15:00:02.124+00:00'})
    return before, refresh(after)


def validate(before, after, outcome='recorded', identifier=None, expected=None):
    proof = expected or (capture()['snapshots']['rows'][0] if outcome == 'duplicate' else
        next(row for row in pair()[1]['snapshots']['rows'] if row['sequence_number'] == 8))
    with patch.object(transition, 'SEAL', SEAL):
        return transition.validate(before, after, started_at=START, finished_at=FINISH,
            outcome=outcome, evidence_id=identifier or evidence(NEW),
            expected_snapshot=proof, seal_manifest=MANIFEST)


class TransitionTests(unittest.TestCase):
    def test_exact_operational_refresh_proves_transition_without_adopting_or_mutating_baseline(self):
        before, after = pair()
        frozen = copy.deepcopy(before)
        post = copy.deepcopy(after)
        result = validate(before, after)
        self.assertFalse(result['baselineAdopted'])
        self.assertEqual(result['allowedBindingFields'], ['verified_at'])
        self.assertEqual(result['transitionSha256'], transition._sha(transition._stable({
            key: value for key, value in result.items() if key != 'transitionSha256'})))
        self.assertEqual(before, frozen)
        self.assertEqual(after, post)

    def test_current_exact_duplicate_is_zero_append_and_complete_unchanged_state(self):
        before = capture()
        after = copy.deepcopy(before)
        after['capturedAt'] = '2026-10-02T15:00:04Z'
        self.assertEqual(validate(before, after, 'duplicate', evidence(OLD))['outcome'], 'duplicate')

    def test_every_non_timestamp_binding_field_change_refuses(self):
        for field in transition.BINDING_FIELDS - {'verified_at'}:
            before, after = pair()
            old = after['bindings']['rows'][0][field]
            after['bindings']['rows'][0][field] = (old + 1 if type(old) is int else
                False if type(old) is bool else old + '-changed')
            refresh(after)
            with self.subTest(field=field), self.assertRaises((ValueError, KeyError)):
                validate(before, after)

    def test_added_binding_or_missing_full_row_refuses_even_with_recomputed_hash(self):
        for added in (True, False):
            before, after = pair()
            if added:
                after['bindings']['rows'].append({**after['bindings']['rows'][0], 'id': 'another'})
            else:
                after['bindings']['rows'][0].pop('source_wallet_id')
            refresh(after)
            with self.assertRaises(ValueError):
                validate(before, after)

    def test_all_twenty_nonbinding_table_hashes_or_counts_must_stay_exact(self):
        for table in TABLES:
            if table == 'prefunded_card.treasury_bindings':
                continue
            for field, changed in (('count', 2), ('sha256', 'c' * 64)):
                before, after = pair()
                after['protected']['tables'][table][field] = changed
                with self.subTest(table=table, field=field), self.assertRaises(ValueError):
                    validate(before, after)

    def test_financial_goal_intent_operation_metadata_and_retired_history_changes_refuse(self):
        for field in ('goal', 'intent', 'operation', 'treasuryIdentity', 'retirementAudits'):
            before, after = pair()
            if isinstance(after['financial'][field], dict):
                after['financial'][field]['unauthorized'] = True
            else:
                after['financial'][field].append({'unauthorized': True})
            refresh(after)
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate(before, after)

    def test_original_principal_cap_reserve_consume_and_new_operations_refuse(self):
        for mutate in (lambda value: value['financial']['goal'].update(current_amount=99),
                lambda value: value['financial']['treasuryIdentity'].update(opening_available_kobo=20000),
                lambda value: value['financial']['replenishments'].append({'amount_kobo': 10000}),
                lambda value: value['financial'].update(otherIntentCount=1),
                lambda value: value['financial'].update(otherOperationCount=True),
                lambda value: value['bindings']['rows'][0].update(reserved_kobo=1),
                lambda value: value['bindings']['rows'][0].update(consumed_kobo=1)):
            before, after = pair()
            mutate(after)
            refresh(after)
            with self.assertRaises(ValueError):
                validate(before, after)

    def test_historical_snapshot_modification_or_deletion_refuses(self):
        for deletion in (True, False):
            before, after = pair()
            historical = next(row for row in after['snapshots']['rows'] if row['sequence_number'] == 7)
            if deletion:
                after['snapshots']['rows'].remove(historical)
            else:
                historical['available_kobo'] = 9999
            refresh(after)
            with self.assertRaisesRegex(ValueError, 'historical_snapshot_changed'):
                validate(before, after)

    def test_snapshot_amount_verifier_binding_evidence_and_sequence_drift_refuse(self):
        for field, changed in (('available_kobo', 9999), ('verified_by', 'worker'),
                ('treasury_binding_id', 'another'), ('evidence_id', 'pvts_' + 'c' * 64),
                ('sequence_number', 9)):
            before, after = pair()
            next(row for row in after['snapshots']['rows'] if row['sequence_number'] == 8)[field] = changed
            refresh(after)
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate(before, after)

    def test_future_nonmonotonic_or_post_pass_snapshot_timestamps_refuse(self):
        for observed in ('2026-10-02T15:00:05.000+00:00', OLD, '2026-10-02T15:00:02.123456+00:00'):
            before, after = pair()
            row = next(row for row in after['snapshots']['rows'] if row['sequence_number'] == 8)
            row.update(observed_at=observed, evidence_id=evidence(observed))
            after['bindings']['rows'][0]['verified_at'] = observed
            refresh(after)
            with self.assertRaises(ValueError):
                validate(before, after, identifier=evidence(observed))
        before, after = pair()
        next(row for row in after['snapshots']['rows'] if row['sequence_number'] == 8)['verified_at'] = after['capturedAt']
        refresh(after)
        with self.assertRaises(ValueError):
            validate(before, after)

    def test_missing_or_extra_snapshot_and_duplicate_with_any_change_refuse(self):
        before, after = pair()
        for outcome in ('duplicate', 'recorded'):
            value = copy.deepcopy(after)
            if outcome == 'recorded':
                value['snapshots']['rows'] = copy.deepcopy(before['snapshots']['rows'])
            refresh(value)
            with self.assertRaises(ValueError):
                validate(before, value, outcome)

    def test_changed_function_source_pin_refuses_even_if_both_captures_match(self):
        before, after = pair()
        for value in (before, after):
            value['security']['detail']['routines'][next(iter(FUNCTIONS))]['sourceSha256'] = 'd' * 64
            refresh(value)
        with self.assertRaisesRegex(ValueError, 'actual_function_source_pin'):
            validate(before, after)

    def test_rls_acl_trigger_schema_and_collector_pin_drift_refuse(self):
        for field in ('relations', 'policies', 'triggers', 'roles', 'memberships', 'schemas'):
            before, after = pair()
            after['security']['detail'][field] = [{'unauthorized': True}]
            refresh(after)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'schema_acl_source_drift'):
                validate(before, after)
        before, after = pair()
        after['sources']['modules'][next(iter(MODULES.values()))] = 'e' * 64
        with self.assertRaisesRegex(ValueError, 'r8_collector_source_pins'):
            validate(before, after)

    def test_actual_definition_hash_and_full_expected_snapshot_are_pinned(self):
        before, after = pair()
        after['security']['detail']['routines'][next(iter(FUNCTIONS))]['definitionSha256'] = 'f' * 64
        refresh(after)
        with self.assertRaisesRegex(ValueError, 'actual_function_source_pin'):
            validate(before, after)
        before, after = pair()
        expected = copy.deepcopy(next(row for row in after['snapshots']['rows'] if row['sequence_number'] == 8))
        expected['verified_at'] = FINISH
        with self.assertRaisesRegex(ValueError, 'full_actual_snapshot_proof_required'):
            validate(before, after, expected=expected)

    def test_missing_table_or_fabricated_financial_binding_canonical_hash_refuses(self):
        for mutate in (lambda value: value['protected']['tables'].pop(TABLES[0]),
                lambda value: value['protected'].update(protectedFinancialSha256='f' * 64),
                lambda value: value['bindings']['canonicalRows'].__setitem__(0, '{}'),
                lambda value: value['financial'].update(otherIntentCount=True)):
            before, after = pair()
            mutate(after)
            with self.assertRaises(ValueError):
                validate(before, after)


if __name__ == '__main__':
    unittest.main()
