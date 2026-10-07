from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import checkout_retirement_rehearsal as diagnostic
from checkout_retirement_contract import render_transaction


class RehearsalDiagnosticTests(unittest.TestCase):
    def fixture(self):
        with patch('checkout_retirement_contract.approval', return_value={}), \
                patch('checkout_retirement_contract.validate'):
            return render_transaction(Path(__file__).parent, {'protected': 'a' * 64}, {}, rehearsal=True)

    def test_diagnostic_only_annotates_real_rollback_transaction(self):
        original = self.fixture()
        annotated, labels = diagnostic.annotate(original, Path(__file__).parent)
        restored = '\n'.join(line for line in annotated.splitlines()
                             if not line.startswith(('\\echo ', "  RAISE NOTICE 'BACI_RETIREMENT_")))
        self.assertEqual(restored, original)
        self.assertEqual(len(labels), 20)
        self.assertIn('function-guard_operation', labels)
        self.assertIn('function-record_collection_reversal', labels)
        self.assertTrue(annotated.endswith('ROLLBACK;\n\\echo BACI_RETIREMENT_CHECK:rolled-back\n'))
        with self.assertRaises(diagnostic.Refused):
            diagnostic.annotate(original.removesuffix('ROLLBACK;') + 'COMMIT;', Path(__file__).parent)

    def test_reports_only_known_marker_and_sqlstate_without_error_contents(self):
        result = SimpleNamespace(returncode=3,
            stdout='secret output\nBACI_RETIREMENT_CHECK:function-guard_operation\nBACI_RETIREMENT_CHECK:secret-token\n',
            stderr='ERROR:  55000\nDETAIL: sk_test_secret\n')
        report = diagnostic.safe_result(result, {'function-guard_operation'})
        self.assertEqual(report, dict(status='refused', failedCheck='function-guard_operation',
                                     sqlState='55000', exitCode=3))
        self.assertNotIn('secret', str(report))
        result.stderr = 'ERROR: sk_test_secret\n'
        self.assertIsNone(diagnostic.safe_result(result, set())['sqlState'])

    def test_success_requires_explicit_completed_rollback_marker(self):
        result = SimpleNamespace(returncode=0, stdout='BACI_RETIREMENT_CHECK:rolled-back\n', stderr='')
        self.assertEqual(diagnostic.safe_result(result, {'rolled-back'})['status'], 'rolled-back')
        result.stdout = ''
        self.assertEqual(diagnostic.safe_result(result, {'rolled-back'})['status'], 'refused')

    def test_function_diagnostics_select_metadata_and_never_definition_bodies(self):
        with patch.object(diagnostic, 'probe', return_value=[]) as query:
            self.assertEqual(diagnostic.function_metadata(Path(__file__).parent), [])
        sql = query.call_args.args[0]
        self.assertIn('sha256(convert_to(routine.prosrc', sql)
        self.assertNotIn('pg_get_functiondef', sql)
        self.assertNotIn('CREATE ', sql)
        self.assertNotIn('UPDATE ', sql)
        self.assertNotIn('DELETE ', sql)

    def test_main_succeeds_only_for_confirmed_rollback_and_unchanged_state(self):
        ready = dict(status='rolled-back', snapshotUnchanged=True, protectedStateUnchanged=True)
        with patch.object(diagnostic, 'execute', return_value=ready):
            diagnostic.main('/root/reviewed')
        for changes in (dict(status='refused'), dict(snapshotUnchanged=False),
                        dict(protectedStateUnchanged=False), dict(snapshotUnchanged=None)):
            with self.subTest(changes=changes), \
                    patch.object(diagnostic, 'execute', return_value={**ready, **changes}), \
                    self.assertRaises(SystemExit) as stopped:
                diagnostic.main('/root/reviewed')
            self.assertEqual(stopped.exception.code, 1)


if __name__ == '__main__':
    unittest.main()
