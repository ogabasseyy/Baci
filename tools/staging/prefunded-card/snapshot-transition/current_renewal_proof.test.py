import copy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import current_renewal_proof as proof
import snapshot_transition as transition

FIXTURE = runpy.run_path(str(Path(__file__).with_name('snapshot_transition.test.py')))
START = '2026-10-02T15:00:01Z'
FINISH = '2026-10-02T15:00:03Z'


def raw(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fixture():
    files = {relative: 'b' * 64 for relative in proof.SOURCE_MODULES.values()}
    files['tooling/card-week-renewal/sealed-source.json'] = 'b' * 64
    manifest = raw({'files': files})
    seal = digest(manifest)
    census = FIXTURE['capture']()
    census['sources']['sealSha256'] = seal
    metadata = {'bindingHash': 'c' * 64, 'rolesHash': 'd' * 64, 'tableHash': 'e' * 64,
        'protectedHash': 'f' * 64, 'bindingExpiry': '2026-09-29T15:59:10Z',
        'roleExpiry': '2026-09-29T15:59:10Z'}
    history = {'commit': {'status': 'applied', 'protectedStateUnchanged': True,
        'passwordsPrivilegesMembershipUnchanged': True, 'newPaymentStarted': False,
        'publicMutationsEnabled': False, 'sqlSha256': 'a' * 64},
        'candidate': {'databaseSqlSha256': 'a' * 64}, 'sqlSha256': 'a' * 64,
        'rehearsal': {'status': 'rollback_rehearsal_passed', 'databaseSqlSha256': 'a' * 64,
            'rollbackConfirmed': True, 'protectedStateUnchanged': True},
        'rolesBefore': 'a' * 64, 'bindingSqlSha256': 'b' * 64,
        'bindingBefore': {'readOnly': True, 'systemIdentifier': proof.SYSTEM, 'metadata': metadata},
        'bindingCommit': {'status': 'applied', 'sqlSha256': 'b' * 64,
            'passwordPrivilegesMembershipUnchanged': True, 'immutableTriggerRestored': True},
        'bindingRehearsal': {'status': 'rollback_rehearsal_passed', 'sqlSha256': 'b' * 64,
            'triggerRestored': True}}
    origins = {'sealSha256': seal, 'bundleRoot': '/root/r8',
        'modules': {relative: {'path': '/root/r8/' + relative, 'sha256': pin}
                    for relative, pin in files.items()}, 'helperRoot': '/root/sidecar',
        'helpers': {name: 'a' * 64 for name in proof.HELPERS}}
    approved = {'phase': 'prestart', 'capture': census, 'sourceOrigins': origins,
        'materialCanonical': '', 'metadata': {**metadata, 'bindingExpiry': proof.DEADLINE,
            'roleExpiry': proof.DEADLINE}, 'executorFingerprint': 'a' * 64,
        'roles': {name: {'expiresAt': proof.DEADLINE, 'unsafe': False} for name in proof.ROLES}}
    refresh(approved)
    current = copy.deepcopy(approved)
    current['capture']['capturedAt'] = '2026-10-02T15:00:02Z'
    return manifest, seal, approved, current, history, origins


def refresh(value):
    FIXTURE['refresh'](value['capture'])
    value['materialCanonical'] = FIXTURE['canonical']({'financial': value['capture']['financial'],
        'tables': value['capture']['protected']['tables']})
    value['metadata']['protectedHash'] = digest(value['materialCanonical'].encode())


def validate(manifest, seal, approved, current, history, origins, pin=None, phase='prestart'):
    approved_raw = raw(approved)
    with patch.object(proof, 'SEAL', seal), patch.object(transition, 'SEAL', seal):
        return proof._validate(current, approved_raw, pin or digest(approved_raw), history,
            phase=phase, started_at=START, finished_at=FINISH,
            seal_manifest=manifest, origins=origins)


class CurrentRenewalTests(unittest.TestCase):
    def test_current_full_material_proof_retains_genuine_historical_hash_and_original_shape(self):
        data = fixture()
        frozen = copy.deepcopy(data)
        result, receipt = validate(*data)
        self.assertEqual(set(result), {'roles', 'snapshotBinding', 'guardedRenewalCommitted',
            'rollbackRehearsalBoundToSql', 'constraintsAndHistoryPreserved'})
        self.assertEqual(receipt['historicalProtectedHash'], 'f' * 64)
        self.assertEqual(receipt['currentProtectedHash'], data[3]['metadata']['protectedHash'])
        self.assertNotEqual(receipt['currentProtectedHash'], receipt['historicalProtectedHash'])
        self.assertFalse(receipt['baselineAdopted'])
        self.assertEqual(data, frozen)

    def test_each_unrelated_metadata_change_refuses_even_with_recomputed_material(self):
        for field in ('bindingHash', 'rolesHash', 'tableHash', 'bindingExpiry', 'roleExpiry'):
            data = fixture()
            data[3]['metadata'][field] = '0' * 64
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate(*data)

    def test_any_of_all_21_current_table_changes_refuses_despite_valid_new_material_hash(self):
        for table in proof.TABLES:
            data = fixture()
            data[3]['capture']['protected']['tables'][table]['sha256'] = '0' * 64
            data[3]['materialCanonical'] = FIXTURE['canonical']({'financial': data[3]['capture']['financial'],
                'tables': data[3]['capture']['protected']['tables']})
            data[3]['metadata']['protectedHash'] = digest(data[3]['materialCanonical'].encode())
            with self.subTest(table=table), self.assertRaises(ValueError):
                validate(*data)

    def test_financial_only_hash_cannot_substitute_for_full_material_hash(self):
        data = fixture()
        data[3]['metadata']['protectedHash'] = data[3]['capture']['protected']['protectedFinancialSha256']
        with self.assertRaisesRegex(ValueError, 'material_hash'):
            validate(*data)

    def test_canonical_material_must_match_both_full_financial_and_exact_table_details(self):
        for changed in ('financial', 'tables', 'omission', 'duplicate'):
            data = fixture()
            material = json.loads(data[3]['materialCanonical'])
            if changed == 'financial':
                material['financial']['goal']['metadata']['old'] = False
            elif changed == 'tables':
                material['tables'][proof.TABLES[-1]]['count'] += 1
            elif changed == 'omission':
                material.pop('tables')
            data[3]['materialCanonical'] = json.dumps(material)
            if changed == 'duplicate':
                data[3]['materialCanonical'] = '{"tables":{},' + data[3]['materialCanonical'][1:]
            data[3]['metadata']['protectedHash'] = digest(data[3]['materialCanonical'].encode())
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate(*data)

    def test_unpinned_or_stale_approval_and_old_live_evidence_refuse(self):
        for changed in ('pin', 'approved', 'current', 'future', 'phase', 'deadline'):
            data = fixture()
            if changed == 'approved':
                data[2]['capture']['capturedAt'] = '2026-10-02T14:58:59Z'
            elif changed == 'current':
                data[3]['capture']['capturedAt'] = '2026-10-02T15:00:00Z'
            elif changed == 'future':
                data[3]['capture']['capturedAt'] = '2026-10-02T15:00:04Z'
            elif changed == 'phase':
                data[2]['phase'] = 'preschedule'
            elif changed == 'deadline':
                data[3]['capture']['capturedAt'] = '2026-10-07T00:00:00Z'
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate(*data, pin='0' * 64 if changed == 'pin' else None)

    def test_snapshot_refresh_receipt_is_not_an_automatic_baseline_adoption_permission(self):
        data = fixture()
        post = FIXTURE['pair']()[1]
        post['sources']['sealSha256'] = data[1]
        post['capturedAt'] = data[3]['capture']['capturedAt']
        data[3]['capture'] = post
        refresh(data[3])
        with self.assertRaises(ValueError):
            validate(*data)

    def test_credential_safety_and_each_historical_commit_assertion_remain_required(self):
        for group, field in (('commit', 'protectedStateUnchanged'), ('commit', 'newPaymentStarted'),
                ('commit', 'publicMutationsEnabled'), ('commit', 'passwordsPrivilegesMembershipUnchanged'),
                ('commit', 'sqlSha256'), ('candidate', 'databaseSqlSha256'),
                ('rehearsal', 'rollbackConfirmed'), ('rehearsal', 'protectedStateUnchanged'),
                ('rehearsal', 'databaseSqlSha256'), ('bindingCommit', 'immutableTriggerRestored'),
                ('bindingCommit', 'passwordPrivilegesMembershipUnchanged'),
                ('bindingCommit', 'sqlSha256'), ('bindingRehearsal', 'triggerRestored'),
                ('bindingRehearsal', 'sqlSha256')):
            data = fixture()
            old = data[4][group][field]
            data[4][group][field] = not old if type(old) is bool else '0' * 64
            with self.subTest(group=group, field=field), self.assertRaises(ValueError):
                validate(*data)
        for changed in ('fingerprint', 'safety', 'role-set', 'expiry'):
            data = fixture()
            if changed == 'fingerprint':
                data[3]['executorFingerprint'] = '0' * 64
            elif changed == 'role-set':
                data[3]['roles'].pop(proof.ROLES[0])
            else:
                data[3]['roles'][proof.ROLES[0]][{'safety': 'unsafe', 'expiry': 'expiresAt'}[changed]] = True
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate(*data)

    def test_seal_loaded_origin_pin_rls_and_historical_snapshot_drift_refuse(self):
        for changed in ('seal', 'origin', 'pin', 'rls', 'history', 'functions', 'future-snapshot'):
            data = fixture()
            if changed == 'seal':
                data[3]['sourceOrigins']['sealSha256'] = '0' * 64
            elif changed == 'origin':
                data[3]['sourceOrigins']['bundleRoot'] = '/copied/r8'
            elif changed == 'pin':
                data[3]['capture']['sources']['modules'][next(iter(proof.MODULES.values()))] = '0' * 64
            elif changed == 'rls':
                data[3]['capture']['security']['detail']['relations'][0]['rls'] = False
            elif changed == 'history':
                data[3]['capture']['snapshots']['rows'][0]['available_kobo'] = 1
            elif changed == 'functions':
                routines = data[3]['capture']['security']['detail']['routines']
                routines[next(iter(routines))]['definitionSha256'] = '0' * 64
            else:
                data[3]['capture']['bindings']['rows'][0]['verified_at'] = '2026-10-03T00:00:00Z'
            refresh(data[3])
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate(*data)

    def test_root_entrypoint_queries_real_wrapper_once_preserves_all_original_private_sql_pins(self):
        manifest, seal, approved, current, history, origins = fixture()
        audit = Path('/root/audit')
        approval = Path('/root/approval/current.json')
        renewal_sql, binding_sql = b'reviewed renewal SQL', b'reviewed binding SQL'
        history['commit']['sqlSha256'] = digest(renewal_sql)
        history['candidate']['databaseSqlSha256'] = digest(renewal_sql)
        history['rehearsal']['databaseSqlSha256'] = digest(renewal_sql)
        history['bindingCommit']['sqlSha256'] = digest(binding_sql)
        history['bindingRehearsal']['sqlSha256'] = digest(binding_sql)
        paths = {'commit': 'commit-result.json', 'rehearsal': 'rehearsal-result.json',
            'candidate': 'renewal-candidate/candidate.json', 'bindingBefore': 'snapshot-baseline.json',
            'bindingCommit': 'snapshot-commit-result.json', 'bindingRehearsal': 'snapshot-rehearsal-result.json'}
        files = {audit / relative: raw(history[key]) for key, relative in paths.items()}
        files.update({audit / 'renewal-candidate/database-renewal.sql': renewal_sql,
            audit / 'snapshot-candidate/commit.sql': binding_sql,
            audit / 'roles-before-sha256.txt': history['rolesBefore'].encode(), approval: raw(approved)})
        query = Mock(return_value=raw(current).decode())
        io = SimpleNamespace(root_ancestors=Mock(), private_directory=Mock(),
            read_file=Mock(side_effect=lambda path, owner, mode, limit: files[path]))
        modules = {'treasury_owner_io': io, 'owner_database': SimpleNamespace(database=query)}
        with patch.object(proof, '_sources', return_value=(modules, manifest, origins)), \
                patch.object(proof, '_render', return_value='actual readonly wrapper'), \
                patch.object(proof, 'datetime') as clock, patch.object(proof, 'SEAL', seal), \
                patch.object(transition, 'SEAL', seal):
            clock.now.side_effect = [datetime.fromisoformat(value.replace('Z', '+00:00'))
                                    for value in (START, FINISH)]
            result, receipt = proof.prove(audit, '/root/r8', approval, digest(files[approval]),
                phase='prestart', helper_pins=origins['helpers'], query=query, with_receipt=True)
        query.assert_called_once_with('actual readonly wrapper')
        self.assertTrue(result['rollbackRehearsalBoundToSql'])
        self.assertEqual(receipt['approvedCaptureSha256'], digest(files[approval]))
        self.assertTrue(all(call.args[1:3] == (0, 0o600) for call in io.read_file.call_args_list))
        self.assertEqual(files[approval], raw(approved))

    def test_unsealed_query_interface_refuses_before_any_database_operation(self):
        query = Mock()
        modules = {'owner_database': SimpleNamespace(database=query)}
        with patch.object(proof, '_sources', return_value=(modules, b'', {})), \
                self.assertRaisesRegex(ValueError, 'actual_query_required'):
            proof.prove('/root/audit', '/root/r8', '/root/approval', 'a' * 64,
                phase='prestart', helper_pins={}, query=lambda statement: '{}')
        query.assert_not_called()


if __name__ == '__main__':
    unittest.main()
