import copy
import builtins
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace


SPEC = importlib.util.spec_from_file_location('ledger_repair_owner',
                                            Path(__file__).with_name('owner.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CANDIDATE = Path(__file__).resolve().parents[3] / 'supabase/migrations/' \
    '20261003160000_piggyvest_ledger_deferred_balance_authority.sql'
SNAPSHOT = Path(__file__).resolve().parents[1] / 'replay-complete-cutover-owner/financial_snapshot.sql'


def snapshot():
    return dict(capturedAt='before', permanentMetadataSha256='original',
        tableRows={'ledger.postings': {'count': 0, 'sha256': 'unchanged'}},
        functions={'claim': 'unchanged'}, identity={'database': 'isolated'}, readOnly=True,
        unsupportedRelations=[])


def evidence():
    return dict(normal={'protectedSnapshot': snapshot()}, masked=snapshot(),
        checker=dict(prosecdef=False, prosrc='pinned', proacl=['postgres'], proowner=10))


def same_snapshot(first, second):
    MODULE.require({name: value for name, value in first.items() if name != 'capturedAt'}
        == {name: value for name, value in second.items() if name != 'capturedAt'})


class LedgerRepairOwnerTests(unittest.TestCase):
    def test_known_reminder_continuity_never_hides_unrelated_baseline_drift(self):
        helper = Path(__file__).with_name('reminder_continuity.py').read_bytes()
        scope = {'__name__': 'fixture_reminder'}
        builtins.exec(compile(helper, 'fixture_reminder', 'exec'), scope)
        previous = snapshot()
        previous['tableRows'][scope['RELATION']] = dict(scope['HISTORICAL'])
        previous['allowedTargetWitnesses'] = {scope['RELATION']: {'targetCount': 0}}
        current = copy.deepcopy(previous)
        current['tableRows'][scope['RELATION']] = dict(scope['CURRENT'])
        current['allowedTargetWitnesses'][scope['RELATION']] = json.loads(
            Path(__file__).with_name('notification-witness.fixture.json').read_text())
        retained = dict(application={}, protectedSnapshot=previous)
        proof = scope['EXPECTED_PROOF']

        for drift in (False, True):
            actual = copy.deepcopy(current)
            if drift:
                actual['permanentMetadataSha256'] = 'changed'
            diagnostic = SimpleNamespace(decode=json.loads, protected_root_read=Mock(
                side_effect=[json.dumps(retained).encode(), json.dumps(proof).encode()]))
            with patch.object(MODULE, 'protected_bytes', return_value=helper) as read:
                if drift:
                    with self.assertRaises(ValueError):
                        MODULE.baseline_matches(diagnostic, {'normal': {'protectedSnapshot': actual}}, same_snapshot)
                else:
                    MODULE.baseline_matches(diagnostic, {'normal': {'protectedSnapshot': actual}}, same_snapshot)
            self.assertEqual(read.call_args.args[1], MODULE.REMINDER_SHA)
            self.assertEqual(diagnostic.protected_root_read.call_args.args,
                             (Path(scope['PROOF_PATH']), scope['PROOF_SHA']))
            self.assertEqual(actual['tableRows'][scope['RELATION']]['count'], 8)
            query = MODULE.transaction_fence(SNAPSHOT.read_bytes(), actual)
            self.assertIn('"count":8', query)
            self.assertIn('914e9941-c9c1-44a1-9879-1de3e54ac365', query)

    def test_continuity_tampering_refuses_before_dependency_execution(self):
        with patch.object(MODULE, 'protected_bytes', side_effect=[b'never execute', ValueError()]), \
            patch.object(MODULE, 'exec', create=True) as execute:
            with self.assertRaises(ValueError):
                MODULE.dependency()
        execute.assert_not_called()

    def test_dependency_authenticates_continuity_before_replacing_only_worker_unit(self):
        helper = Path(__file__).with_name('reboot_continuity.py').read_bytes()
        source = ("WORKER='3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4'\n"
                  "DEADLINE='2026-10-06T15:59:10Z'\n"
                  "guard='original-guard'\nbootstrap='original-bootstrap'\n").encode()
        with patch.object(MODULE, 'protected_bytes', side_effect=[source, helper]) as read:
            result = MODULE.dependency()
        self.assertEqual(read.call_args_list[0].args, (MODULE.DEPENDENCY, MODULE.DEPENDENCY_SHA))
        self.assertEqual(read.call_args_list[1].args[1], MODULE.CONTINUITY_SHA)
        self.assertEqual(result.guard, 'original-guard')
        self.assertEqual(result.bootstrap, 'original-bootstrap')
        self.assertTrue(callable(result.worker_unit))

    def query(self, source, mode):
        return MODULE.candidate_query(source, mode,
            MODULE.transaction_fence(SNAPSHOT.read_bytes(), snapshot()))

    def test_rehearsal_has_no_commit_and_validates_applied_projection_before_rollback(self):
        source = self.query(CANDIDATE.read_bytes(), '--rehearse')
        self.assertNotIn('COMMIT;', source)
        self.assertTrue(source.endswith('ROLLBACK;\n'))
        self.assertLess(source.index('SET CONSTRAINTS ALL IMMEDIATE'), source.rindex('ROLLBACK;'))
        self.assertIn("'projection-rehearsal','outcome'", source)
        self.assertLess(source.index("IF outcome IS DISTINCT FROM 'applied'"),
                        source.index('SET CONSTRAINTS ALL IMMEDIATE'))
        self.assertIn("system_identifier::text FROM pg_control_system()", source)
        self.assertIn('2026-10-06T15:59:10Z', source)

    def test_apply_only_retains_candidate_metadata_mutation(self):
        source = self.query(CANDIDATE.read_bytes(), '--apply')
        self.assertEqual(source.count('COMMIT;'), 1)
        self.assertNotIn('prefunded_card.project(', source)
        self.assertNotIn('GRANT ', source)
        self.assertIn('check_balance() SECURITY DEFINER;', source)
        self.assertLess(source.index('repair full snapshot refused'), source.rindex('COMMIT;'))
        self.assertIn("evidence-'capturedAt'", source)

    def test_unsealed_candidate_boundaries_refuse_without_query(self):
        for source, mode in ((b'COMMIT;\n', '--apply'),
            (b'BEGIN;\nCOMMIT;\nCOMMIT;\n', '--rehearse'),
            (b'BEGIN;\nBEGIN;\nCOMMIT;\n', '--rehearse'),
            (CANDIDATE.read_bytes(), '--unknown')):
            with self.assertRaises(ValueError):
                self.query(source, mode)

    def test_missing_transaction_snapshot_fence_refuses_candidate_execution(self):
        for fence in ('', 'COMMIT;\n', None):
            with self.assertRaises(ValueError):
                MODULE.candidate_query(CANDIDATE.read_bytes(), '--apply', fence)

    def test_transaction_fence_checks_all_rows_and_metadata_with_only_explicit_mask(self):
        source = MODULE.transaction_fence(SNAPSHOT.read_bytes(), snapshot())
        self.assertIn(MODULE.MASK_TO, source)
        self.assertIn('permanentMetadataSha256', source)
        self.assertIn('tableRows', source)
        self.assertIn('roles', source)
        self.assertNotIn('BEGIN ISOLATION LEVEL', source)
        self.assertNotIn('COMMIT;', source)
        for bad in (dict(snapshot(), readOnly=False), dict(snapshot(), unsupportedRelations=['foreign'])):
            with self.assertRaises(ValueError):
                MODULE.transaction_fence(SNAPSHOT.read_bytes(), bad)

    def test_mask_only_removes_checker_authority_from_routine_metadata(self):
        source = ('before ' + MODULE.MASK_FROM + ' after').encode()
        self.assertEqual(MODULE.masked_source(source), 'before ' + MODULE.MASK_TO + ' after')
        for bad in (b'no metadata', source + source,
                    source + MODULE.MASK_TO.encode()):
            with self.assertRaises(ValueError):
                MODULE.masked_source(bad)

    def test_rehearsal_requires_all_actual_rows_and_metadata_unchanged(self):
        before, after = evidence(), evidence()
        after['normal']['protectedSnapshot']['capturedAt'] = 'after'
        MODULE.prove(before, after, '--rehearse', same_snapshot)
        after['normal']['protectedSnapshot']['permanentMetadataSha256'] = 'changed'
        with self.assertRaises(ValueError):
            MODULE.prove(before, after, '--rehearse', same_snapshot)

    def test_apply_permits_only_checker_flag_and_matching_full_metadata_witness(self):
        before, after = evidence(), evidence()
        original = copy.deepcopy(before)
        after['checker']['prosecdef'] = True
        after['normal']['protectedSnapshot']['permanentMetadataSha256'] = 'changed'
        MODULE.prove(before, after, '--apply', same_snapshot)
        self.assertEqual(before, original)
        for path, key, value in ((('checker',), 'proacl', ['PUBLIC']),
            (('checker',), 'prosrc', 'changed'),
            (('checker',), 'proowner', 20),
            (('masked',), 'permanentMetadataSha256', 'changed'),
            (('normal', 'protectedSnapshot'), 'functions', {'claim': 'changed'}),
            (('normal', 'protectedSnapshot'), 'tableRows', {'ledger.postings': {'count': 1}})):
            damaged = copy.deepcopy(after)
            target = damaged
            for name in path:
                target = target[name]
            target[key] = value
            with self.assertRaises(ValueError):
                MODULE.prove(before, damaged, '--apply', same_snapshot)

    def test_changed_financial_rows_refuse_even_if_checker_flag_matches(self):
        before, after = evidence(), evidence()
        after['checker']['prosecdef'] = True
        after['normal']['protectedSnapshot']['permanentMetadataSha256'] = 'changed'
        after['masked']['tableRows']['ledger.postings']['count'] = 2
        with self.assertRaises(ValueError):
            MODULE.prove(before, after, '--apply', same_snapshot)

    def test_unknown_modes_and_non_boolean_authority_refuse(self):
        for mode, value in (('--unknown', False), ('--apply', 1), ('--rehearse', 0)):
            before, after = evidence(), evidence()
            after['checker']['prosecdef'] = value
            with self.assertRaises(ValueError):
                MODULE.prove(before, after, mode, same_snapshot)

    def test_invalid_arguments_never_read_private_files_or_initialize_context(self):
        with patch.object(MODULE.os, 'geteuid', return_value=0), \
            patch.object(MODULE, 'protected_bytes') as read, \
            patch.object(MODULE, 'dependency') as dependency, \
            patch('sys.stdout', new_callable=io.StringIO) as output:
            code = MODULE.main(['--apply', 'unexpected'])
        self.assertEqual(code, 1)
        read.assert_not_called()
        dependency.assert_not_called()
        self.assertFalse(json.loads(output.getvalue())['metadataApplied'])

    def test_drift_since_actual_tls_diagnostic_refuses_before_any_repair(self):
        retained = dict(application={}, protectedSnapshot=snapshot())
        diagnostic = SimpleNamespace(decode=json.loads, protected_root_read=lambda path, pin:
            json.dumps(retained).encode())
        before = evidence()
        MODULE.baseline_matches(diagnostic, before, same_snapshot)
        before['normal']['protectedSnapshot']['functions'] = {'claim': 'different'}
        with self.assertRaises(ValueError):
            MODULE.baseline_matches(diagnostic, before, same_snapshot)

    def test_non_readonly_or_wrong_baseline_shape_refuses(self):
        for retained in ({'protectedSnapshot': snapshot()},
            dict(application={}, protectedSnapshot=dict(snapshot(), readOnly=False))):
            diagnostic = SimpleNamespace(decode=json.loads, protected_root_read=lambda path, pin:
                json.dumps(retained).encode())
            with self.assertRaises(ValueError):
                MODULE.baseline_matches(diagnostic, evidence(), same_snapshot)


if __name__ == '__main__':
    unittest.main()
