import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'legacy_history_owner_diagnostic', HERE / 'legacy_history_owner_diagnostic.py'
)
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class LegacyHistoryOwnerDiagnosticTests(unittest.TestCase):
    def test_accepts_only_standalone_sqlstate_diagnostic_line(self):
        state = diagnostic._sql_state('ERROR:  42501\n')
        self.assertEqual(state, '42501')
        self.assertEqual(diagnostic._sql_state('ERROR:  23514\n'), '23514')
        self.assertEqual(diagnostic._sql_state('ERROR:  23505\n'), '23505')
        self.assertIsNone(diagnostic._sql_state('ERROR:  ZZ999\n'))
        self.assertIsNone(diagnostic._sql_state('ERROR:  42501: secret detail\n'))
        self.assertIsNone(diagnostic._sql_state('ERROR: secret 23505 detail\n'))

    def test_diagnostic_has_only_bounded_fields_and_never_raw_stderr(self):
        secret = 'password=private SELECT hidden_rows'
        outcome = diagnostic._unconfirmed(
            'nonzero-exit', 'subprocess', 1, False,
            f'ERROR: {secret}\nDETAIL: {secret}',
        )
        self.assertEqual(outcome, {
            'changesMade': None,
            'diagnostic': {
                'phase': 'subprocess', 'exitCode': 1,
                'timedOut': False, 'failure': 'nonzero-exit',
            },
        })
        self.assertNotIn(secret, repr(outcome))


if __name__ == '__main__':
    unittest.main()
