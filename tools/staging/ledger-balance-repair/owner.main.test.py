import copy
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('ledger_repair_main_owner',
                                            Path(__file__).with_name('owner.py'))
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)
PRIVATE = 'PRIVATE-SQL-PASSWORD-EXCEPTION-MUST-NOT-PRINT'
RAW = b'BEGIN;\nALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY DEFINER;\nCOMMIT;\n'
SNAPSHOT_SQL = ('WITH full_snapshot AS MATERIALIZED (SELECT 1 /* ' + OWNER.MASK_FROM +
                " */) SELECT '{}'::jsonb;\nDO $financial_deadline$ BEGIN END;\n").encode()


def snapshot():
    return dict(capturedAt='before', readOnly=True, unsupportedRelations=[],
                permanentMetadataSha256='original', identity={'database': 'isolated'},
                tableRows={'ledger.postings': {'count': 0, 'sha256': 'unchanged'}},
                functions={'claim': 'unchanged'})


def evidence():
    return dict(normal={'application': {'private': PRIVATE}, 'protectedSnapshot': snapshot()},
                masked=snapshot(), checker={'prosecdef': False, 'prosrc': PRIVATE,
                                            'proowner': 10, 'proacl': ['postgres']})


def same_snapshot(first, second):
    OWNER.require({key: value for key, value in first.items() if key != 'capturedAt'}
                  == {key: value for key, value in second.items() if key != 'capturedAt'})


class LedgerRepairMainTests(unittest.TestCase):
    def test_reminder_continuity_pin_refusal_never_executes_sql(self):
        with patch.object(OWNER, 'baseline_matches', side_effect=ValueError('reminder_pin_refused')):
            code, result = self.run_main()
        self.assertEqual(code, 1)
        self.command.assert_not_called()
        self.assertFalse(result['metadataApplied'])

    def setUp(self):
        self.events = []
        self.before = evidence()
        self.after = copy.deepcopy(self.before)
        self.mode = '--rehearse'
        self.pins = {'financial_report.sql': 'report-pin', 'financial_snapshot.sql': 'snapshot-pin'}
        self.authenticated = {'sealed': 'root-source'}
        self.finder = object()
        self.meta_path = []
        self.journals = []
        self.context = SimpleNamespace(lock=8123, journal=Mock(side_effect=self.journal),
                                      deadline=Mock(), finance={})
        self.command = Mock(side_effect=self.execute)
        self.database = Mock(side_effect=self.read_database)
        self.context.finance.update(command=self.command, database=self.database)
        self.collector = Mock(side_effect=self.collect)
        self.modules = {'application_reports': SimpleNamespace(capture_application=self.collector),
                        'cutover_context': SimpleNamespace(Context=Mock(return_value=self.context))}
        self.closure = Mock(return_value=(self.pins, self.authenticated))
        self.diagnostic = SimpleNamespace(ROOT=Path('/root/sealed-mock'), RELEASE='mock-release',
            DOCKER=['mock-docker'], authenticate_root=Mock(return_value=self.authenticated),
            bootstrap=Mock(side_effect=self.bootstrap), guard=Mock(return_value={'stopped': True}),
            protected_root_read=Mock(side_effect=self.read_protected), decode=json.loads)
        self.dependency = Mock(return_value=self.diagnostic)
        self.read = Mock(return_value=RAW)
        self.output = io.StringIO()
        self.errors = io.StringIO()
        self.close = Mock()
        self.query = Mock(wraps=OWNER.candidate_query)
        self.fence = Mock(wraps=OWNER.transaction_fence)
        for patcher in [patch.object(OWNER.os, 'geteuid', return_value=0),
            patch.object(OWNER.os, 'chmod'), patch.object(OWNER.os, 'close', self.close),
            patch.object(OWNER.tempfile, 'mkdtemp', return_value='/root/mock-private-audit'),
            patch.object(OWNER, 'protected_bytes', self.read),
            patch.object(OWNER, 'dependency', self.dependency),
            patch.object(OWNER, 'candidate_query', self.query),
            patch.object(OWNER, 'transaction_fence', self.fence),
            patch.object(OWNER.sys, 'meta_path', self.meta_path),
            patch.dict('sys.modules', {'financial_reconcile_pass':
                SimpleNamespace(_same_snapshot=same_snapshot)}),
            patch('sys.stdout', self.output), patch('sys.stderr', self.errors)]:
            patcher.start()
            self.addCleanup(patcher.stop)

    def bootstrap(self, authenticated):
        self.assertEqual(authenticated, self.authenticated)
        self.meta_path.append(self.finder)
        return (SimpleNamespace(_closure=self.closure),
                SimpleNamespace(_load_modules=Mock(return_value=self.modules)), self.finder)

    def read_protected(self, path, pin):
        if path == OWNER.BASELINE:
            self.assertEqual(pin, OWNER.BASELINE_SHA)
            self.events.append('baseline')
            return json.dumps(self.before['normal']).encode()
        self.assertEqual(path, self.diagnostic.ROOT / 'financial_snapshot.sql')
        self.assertEqual(pin, self.pins['financial_snapshot.sql'])
        self.events.append('sealed-snapshot-sql')
        return SNAPSHOT_SQL

    def collect(self, context, report, report_pin, source, source_pin):
        self.assertIs(context, self.context)
        self.assertEqual((report, report_pin, source, source_pin),
            (self.diagnostic.ROOT / 'financial_report.sql', self.pins['financial_report.sql'],
             self.diagnostic.ROOT / 'financial_snapshot.sql', self.pins['financial_snapshot.sql']))
        self.events.append('full-capture')
        return copy.deepcopy(self.before['normal'] if self.collector.call_count == 1 else self.after['normal'])

    def read_database(self, query):
        current = self.before if self.collector.call_count == 1 else self.after
        if query == OWNER.CHECKER_QUERY:
            return json.dumps(current['checker'])
        self.assertEqual(query, OWNER.masked_source(SNAPSHOT_SQL))
        return json.dumps(current['masked'])

    def execute(self, arguments, input_text):
        self.events.append('sql-execution')
        self.assertEqual(arguments, ['mock-docker', 'exec', '-i', 'baci-isolated-savings-db-1',
            '/usr/bin/psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
            '-U', 'postgres', '-d', 'postgres'])
        self.assertIn('CREATE TEMP TABLE ledger_repair_full_expected', input_text)
        self.assertIn('repair full snapshot refused', input_text)
        self.assertLess(self.events.index('full-capture'), self.events.index('baseline'))
        self.assertLess(self.events.index('baseline'), self.events.index('sql-execution'))
        if self.mode == '--apply':
            self.assertTrue(input_text.endswith('COMMIT;\n'))
            self.assertNotIn('prefunded_card.project(', input_text)
            self.after['checker']['prosecdef'] = True
            self.after['normal']['protectedSnapshot']['permanentMetadataSha256'] = 'authority-changed'
            return PRIVATE
        self.assertNotIn('COMMIT;', input_text)
        self.assertTrue(input_text.endswith('ROLLBACK;\n'))
        return '\n'.join(json.dumps(row) for row in [
            {'status': 'projection-rehearsal', 'outcome': 'applied'},
            {'status': 'repair-constraints-validated', 'financialCommitted': False}])

    def journal(self, directory, name, value):
        self.journals.append((name, copy.deepcopy(value)))

    def run_main(self):
        code = OWNER.main([self.mode])
        lines = self.output.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertNotIn(PRIVATE, lines[0])
        self.assertNotIn('ALTER FUNCTION', lines[0])
        self.assertEqual(self.errors.getvalue(), '')
        result = json.loads(lines[0])
        self.assertFalse(result['newPaymentStarted'])
        return code, result

    def test_valid_rehearsal_retains_before_execution_after_result_and_cleans_up(self):
        code, result = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'ledger-balance-rehearsed')
        self.assertFalse(result['metadataApplied'])
        self.assertFalse(result['financialCommitted'])
        self.assertEqual([name for name, value in self.journals], ['before', 'execution', 'after', 'result'])
        self.assertEqual(self.collector.call_count, 2)
        self.command.assert_called_once()
        self.query.assert_called_once()
        self.fence.assert_called_once_with(SNAPSHOT_SQL, self.before['masked'])
        self.close.assert_called_once_with(self.context.lock)
        self.assertEqual(self.meta_path, [])

    def test_valid_apply_allows_only_checker_authority_change_and_no_projection(self):
        self.mode = '--apply'
        code, result = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'ledger-balance-repaired')
        self.assertTrue(result['metadataApplied'])
        self.assertTrue(result['onlyCheckerAuthorityChanged'])
        self.assertFalse(result['financialCommitted'])
        self.command.assert_called_once()
        self.assertEqual(self.collector.call_count, 2)
        self.assertEqual(self.meta_path, [])

    def test_sql_failure_retains_actual_post_evidence_refuses_and_never_retries(self):
        self.after['normal']['application']['actual-post-marker'] = 'retained'
        self.command.side_effect = RuntimeError(PRIVATE)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(result['status'], 'ledger-balance-repair-unconfirmed')
        self.assertTrue(result['postEvidenceRetained'])
        self.assertIsNone(result['metadataApplied'])
        self.assertEqual([name for name, value in self.journals], ['before', 'execution-failure', 'after'])
        self.assertEqual(self.journals[1][1],
            {'mode': self.mode, 'redacted': True, 'exceptionType': 'RuntimeError'})
        self.assertEqual(self.journals[-1][1], self.after)
        self.assertEqual(self.collector.call_count, 2)
        self.command.assert_called_once()
        self.context.deadline.assert_not_called()

    def test_baseline_failure_captures_before_but_never_executes_sql(self):
        self.diagnostic.protected_root_read.side_effect = lambda path, pin: (
            json.dumps({'application': {}, 'protectedSnapshot':
                dict(snapshot(), permanentMetadataSha256='wrong-baseline')}).encode()
            if path == OWNER.BASELINE else SNAPSHOT_SQL)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertFalse(result['metadataApplied'])
        self.assertFalse(result['postEvidenceRetained'])
        self.command.assert_not_called()
        self.query.assert_not_called()
        self.fence.assert_not_called()
        self.assertEqual([name for name, value in self.journals], ['before'])

    def test_root_dependency_failure_never_initializes_context_or_executes_sql(self):
        self.dependency.side_effect = ValueError(PRIVATE)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(result['stage'], 'sealed-inputs')
        self.command.assert_not_called()
        self.collector.assert_not_called()
        self.modules['cutover_context'].Context.assert_not_called()
        self.close.assert_not_called()

    def test_nonroot_preflight_never_reads_sealed_inputs_or_executes_sql(self):
        with patch.object(OWNER.os, 'geteuid', return_value=1001):
            code, result = self.run_main()
        self.assertEqual(code, 1)
        self.read.assert_not_called()
        self.dependency.assert_not_called()
        self.command.assert_not_called()

    def test_global_context_guard_failure_never_captures_or_generates_sql(self):
        self.diagnostic.guard.side_effect = ValueError(PRIVATE)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertFalse(result['metadataApplied'])
        self.collector.assert_not_called()
        self.query.assert_not_called()
        self.fence.assert_not_called()
        self.command.assert_not_called()
        self.close.assert_called_once_with(self.context.lock)

    def test_lock_cleanup_failure_emits_one_redacted_final_report_and_nonzero(self):
        self.close.side_effect = OSError(PRIVATE)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(result['status'], 'ledger-balance-repair-unconfirmed')
        self.assertEqual(result['stage'], 'lock-cleanup')
        self.assertTrue(result['redacted'])
        self.command.assert_called_once()
        self.close.assert_called_once_with(self.context.lock)
        self.assertEqual(self.meta_path, [])

    def test_missing_finder_does_not_escape_and_preserves_applied_metadata_and_audit(self):
        self.mode = '--apply'
        original = self.execute
        def execute_without_finder(arguments, input_text):
            output = original(arguments, input_text)
            self.meta_path.remove(self.finder)
            return output
        self.command.side_effect = execute_without_finder
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(result['stage'], 'import-cleanup')
        self.assertTrue(result['metadataApplied'])
        self.assertFalse(result['financialCommitted'])
        self.assertEqual(result['privateAudit'], '/root/mock-private-audit')
        self.command.assert_called_once()
        self.close.assert_called_once_with(self.context.lock)

    def test_command_and_postcapture_failure_retain_primary_redacted_error_type(self):
        original = self.collect
        def collect_with_post_failure(*arguments):
            if self.collector.call_count == 2:
                raise OSError(PRIVATE)
            return original(*arguments)
        self.collector.side_effect = collect_with_post_failure
        self.command.side_effect = RuntimeError(PRIVATE)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertFalse(result['postEvidenceRetained'])
        self.assertIsNone(result['metadataApplied'])
        self.assertEqual(self.journals[-1], ('execution-failure',
            {'mode': self.mode, 'redacted': True, 'exceptionType': 'RuntimeError'}))
        self.command.assert_called_once()
        self.assertEqual(self.collector.call_count, 2)

    def test_unapproved_exception_class_name_is_not_retained_as_private_diagnostics(self):
        self.command.side_effect = type(PRIVATE, (RuntimeError,), {})(PRIVATE)
        code, result = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(self.journals[1][1],
            {'mode': self.mode, 'redacted': True, 'exceptionType': 'UnknownError'})


if __name__ == '__main__':
    unittest.main()
