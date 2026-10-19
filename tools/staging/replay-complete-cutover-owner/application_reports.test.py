import copy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import application_reports as module


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('synthetic_completion_reports', HERE / 'financial_completion.test.py')
FIXTURES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURES)


def inputs():
    completed = FIXTURES.completed_fixture()
    native = completed['nativeEvidence']
    crosswalk = dict(native['crosswalk'])
    provider_names = ('faasWalletId', 'apiCustomerId', 'nativeCustomerId', 'publicFaasMatches')
    provider = dict(status='provider-crosswalk-readonly-verified', observedAt=native['observedAt'],
        publicWalletId=crosswalk['publicWalletId'], providerCustomerId=crosswalk['providerCustomerId'])
    provider.update({name: crosswalk.pop(name) for name in provider_names})
    application = dict(schemaVersion=1, reportKind='application_financial_subreport',
        observedAt=native['observedAt'], appIdentity=native['appIdentity'],
        nativeApplication={name: native[name] for name in ('scope', 'collection', 'evidence', 'conflicts')},
        completedApplication={name: value for name, value in completed.items() if name not in
            ('schemaVersion', 'proofKind', 'observedAt', 'appIdentity', 'nativeEvidence')})
    application['nativeApplication']['applicationCrosswalk'] = [crosswalk]
    original = {name: native[name] for name in ('receiptStorage', 'provenance')}
    return application, original, provider


class ApplicationReportTests(unittest.TestCase):
    def setUp(self):
        self.application, self.original, self.provider = inputs()
        self.clock = patch.object(module, '_fresh')
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def test_combines_independent_synthetic_reports_without_changing_source_or_inventing_completion(self):
        before = copy.deepcopy((self.application, self.original, self.provider))
        native = module.assemble_native(self.application, self.original, self.provider)
        completed = module.assemble_completed(self.application, self.original, self.provider)
        self.assertEqual(native, FIXTURES.completed_fixture()['nativeEvidence'])
        self.assertEqual(completed, FIXTURES.completed_fixture())
        self.assertEqual((self.application, self.original, self.provider), before)

    def test_provider_flags_do_not_override_false_application_ownership(self):
        self.application['nativeApplication']['applicationCrosswalk'][0]['businessMatches'] = False
        with self.assertRaisesRegex(ValueError, 'native_evidence_refused'):
            module.assemble_native(self.application, self.original, self.provider)

    def test_refuses_duplicate_missing_or_overlapping_application_crosswalks(self):
        for count in (0, 2):
            application = copy.deepcopy(self.application)
            application['nativeApplication']['applicationCrosswalk'] *= count
            with self.assertRaisesRegex(ValueError, 'application_crosswalk_cardinality_refused'):
                module.assemble_native(application, self.original, self.provider)
        self.application['nativeApplication']['applicationCrosswalk'][0]['faasWalletId'] = 'foreign'
        with self.assertRaisesRegex(ValueError, 'application_crosswalk_overlap_refused'):
            module.assemble_native(self.application, self.original, self.provider)

    def test_refuses_provider_namespace_mismatch_and_original_sample_proof(self):
        for name in ('publicWalletId', 'providerCustomerId'):
            provider = dict(self.provider, **{name: 'foreign'})
            with self.assertRaisesRegex(ValueError, 'provider_application_crosswalk_mismatch'):
                module.assemble_native(self.application, self.original, provider)
        original = copy.deepcopy(self.original)
        original['provenance']['origin'] = 'synthetic_fixture'
        with self.assertRaisesRegex(ValueError, 'native_evidence_refused'):
            module.assemble_native(self.application, original, self.provider)

    def test_pending_and_partial_financial_state_never_become_a_completion_proof(self):
        self.application['completedApplication']['operation']['transferStatus'] = 'dispatching'
        with self.assertRaisesRegex(ValueError, 'financial_completion_refused'):
            module.assemble_completed(self.application, self.original, self.provider)

    def test_closed_identity_rejects_extra_fields_wrong_database_and_integer_boolean(self):
        for name, value in [('systemIdentifier', 'foreign'), ('readOnly', 1), ('extra', True)]:
            application = copy.deepcopy(self.application)
            application['appIdentity'][name] = value
            with self.assertRaisesRegex(ValueError, 'application_identity_refused'):
                module.checked_application(application)

    def test_actual_freshness_refuses_stale_and_future_provider_observations(self):
        self.clock.stop()
        latest = datetime.fromisoformat('2026-10-03T08:00:00+00:00')
        for observed in ('2026-10-03T07:58:59Z', '2026-10-03T08:00:01Z'):
            with self.assertRaisesRegex(ValueError, 'application_time_refused'):
                module._fresh(observed, latest)
        module._fresh('2026-10-03T07:59:00Z', latest)

    def test_assembly_rejects_individually_stale_observations_despite_fresh_relative_ordering(self):
        self.clock.stop()
        with patch.object(module, 'datetime') as clock:
            clock.now.return_value = datetime.fromisoformat('2026-10-03T08:01:00+00:00')
            clock.fromisoformat.side_effect = datetime.fromisoformat
            for assembler in (module.assemble_native, module.assemble_completed):
                for selected in range(3):
                    for stale in ('2026-10-03T07:59:59Z', '2026-10-03T07:59:00Z'):
                        with self.subTest(assembler=assembler.__name__, selected=selected, stale=stale):
                            application, original, provider = inputs()
                            application['observedAt'] = '2026-10-03T08:00:00Z'
                            fields = ((provider, 'observedAt'), (original['provenance'], 'sourceProofObservedAt'),
                                      (original['receiptStorage'], 'observedAt'))
                            for record, name in fields:
                                record[name] = application['observedAt']
                            record, name = fields[selected]
                            record[name] = stale
                            with self.assertRaisesRegex(ValueError, '^application_time_refused$'):
                                assembler(application, original, provider)

    def test_assembly_accepts_exact_current_clock_boundary_without_changing_input_timestamps(self):
        self.clock.stop()
        application, original, provider = inputs()
        application['observedAt'] = '2026-10-03T08:00:30Z'
        provider['observedAt'] = original['provenance']['sourceProofObservedAt'] = '2026-10-03T08:00:00Z'
        original['receiptStorage']['observedAt'] = '2026-10-03T08:00:00Z'
        before = copy.deepcopy((application, original, provider))
        with patch.object(module, 'datetime') as clock:
            clock.now.return_value = datetime.fromisoformat('2026-10-03T08:01:00+00:00')
            clock.fromisoformat.side_effect = datetime.fromisoformat
            for assembler in (module.assemble_native, module.assemble_completed):
                self.assertEqual(assembler(application, original, provider)['observedAt'], application['observedAt'])
        self.assertEqual((application, original, provider), before)

    def test_assembly_retains_ordering_guards_for_current_clock_fresh_observations(self):
        self.clock.stop()
        with patch.object(module, 'datetime') as clock:
            clock.now.return_value = datetime.fromisoformat('2026-10-03T08:01:00+00:00')
            clock.fromisoformat.side_effect = datetime.fromisoformat
            for selected in range(3):
                with self.subTest(selected=selected):
                    application, original, provider = inputs()
                    application['observedAt'] = '2026-10-03T08:00:30Z'
                    fields = ((provider, 'observedAt'), (original['provenance'], 'sourceProofObservedAt'),
                              (original['receiptStorage'], 'observedAt'))
                    for record, name in fields:
                        record[name] = application['observedAt']
                    record, name = fields[selected]
                    record[name] = '2026-10-03T08:00:31Z'
                    code = 'application_time_refused' if selected == 0 else 'native_evidence_refused'
                    with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                        module.assemble_native(application, original, provider)

    def test_capture_reads_both_pinned_queries_and_retained_original_snapshot_before_collection(self):
        snapshot = dict(readOnly=True, identity={})
        query_path, snapshot_path = Path('/synthetic/report.sql'), Path('/synthetic/snapshot.sql')
        contents = {query_path: b'BEGIN READ ONLY;SELECT report;ROLLBACK;',
            snapshot_path: b'prefix original_snapshot suffix', module.BASELINE_PATH: b'original_snapshot;\n'}
        database = Mock(side_effect=[json.dumps(self.application), json.dumps(snapshot)])
        context = SimpleNamespace(owner=SimpleNamespace(read=Mock(side_effect=lambda path, pin: contents[path])),
            finance={'database': database}, deadline=Mock())
        with patch.object(module, '_snapshot') as validator:
            result = module.capture_application(context, query_path, 'a' * 64, snapshot_path, 'b' * 64)
        self.assertEqual(result, dict(application=self.application, protectedSnapshot=snapshot))
        self.assertEqual(database.call_count, 2)
        context.owner.read.assert_any_call(module.BASELINE_PATH, module.BASELINE)
        validator.assert_called_once_with(snapshot)
        context.deadline.assert_called_once_with()

    def test_capture_refuses_non_readonly_snapshot_after_real_collector_validation(self):
        contents = {Path('/report'): b'query', Path('/snapshot'): b'original', module.BASELINE_PATH: b'original;'}
        context = SimpleNamespace(owner=SimpleNamespace(read=lambda path, pin: contents[path]),
            finance={'database': Mock(side_effect=[json.dumps(self.application),
                '{"readOnly":false,"identity":{}}'])}, deadline=Mock())
        with patch.object(module, '_snapshot'), self.assertRaisesRegex(ValueError, 'financial_snapshot_readonly_required'):
            module.capture_application(context, Path('/report'), 'a' * 64, Path('/snapshot'), 'b' * 64)
        context.deadline.assert_not_called()


    def test_precommit_assembly_preserves_write_identity_without_claiming_commit(self):
        self.application['appIdentity']['readOnly'] = False
        original = copy.deepcopy((self.application, self.original, self.provider))
        report = module.assemble_precommit(self.application, self.original, self.provider)
        self.assertEqual(report['proofKind'], 'financial_precommit')
        self.assertIs(report['appIdentity']['readOnly'], False)
        self.assertEqual(report['nativeEvidence']['proofKind'], 'native_transfer_precommit')
        self.assertIs(report['nativeEvidence']['receiptStorage']['identity']['readOnly'], True)
        self.assertIs(report['financialCommitted'], False)
        self.assertNotIn('financialProofPassed', report)
        self.assertEqual((self.application, self.original, self.provider), original)
        with self.assertRaises(ValueError):
            module.assemble_completed(self.application, self.original, self.provider)

    def test_precommit_keeps_full_financial_contract_and_rejects_commit_assertions(self):
        self.application['appIdentity']['readOnly'] = False
        for field, value in (('financialCommitted', True), ('activeLeaseCount', 1),
                              ('postings', []), ('goals', []), ('notifications', [])):
            with self.subTest(field=field):
                application = copy.deepcopy(self.application)
                application['completedApplication'][field] = value
                with self.assertRaises(ValueError):
                    module.assemble_precommit(application, self.original, self.provider)
        self.original['provenance']['hmacSha512Verified'] = False
        with self.assertRaises(ValueError):
            module.assemble_precommit(self.application, self.original, self.provider)

    def test_precommit_rejects_readonly_or_non_boolean_app_and_write_receipt_contexts(self):
        for flag in (True, 0, None):
            with self.subTest(flag=flag):
                self.application['appIdentity']['readOnly'] = flag
                with self.assertRaises(ValueError):
                    module.assemble_precommit(self.application, self.original, self.provider)
        self.application['appIdentity']['readOnly'] = False
        self.original['receiptStorage']['identity']['readOnly'] = False
        with self.assertRaises(ValueError):
            module.assemble_precommit(self.application, self.original, self.provider)


if __name__ == '__main__':
    unittest.main()
