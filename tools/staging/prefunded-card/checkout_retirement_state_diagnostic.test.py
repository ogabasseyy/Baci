import json
from pathlib import Path
import unittest

from checkout_retirement_state_diagnostic import annotate_state, safe_details


HERE = Path(__file__).parent


class RetirementStateDiagnosticTests(unittest.TestCase):
    def test_instruments_original_guards_without_changing_any_guard_or_write(self):
        source = (HERE / 'checkout-retirement-apply.sql').read_text()
        annotated = annotate_state(source, HERE)
        restored = ''.join(line for line in annotated.splitlines(keepends=True)
                           if not line.startswith("  RAISE NOTICE 'BACI_RETIREMENT_"))
        self.assertEqual(restored, source)
        self.assertIn('verification-lease-active', annotated)
        self.assertIn('operation-update', annotated)
        self.assertNotIn('COMMIT', annotated)

    def test_only_allowlisted_conditions_steps_and_messages_leave_stderr(self):
        detail = dict(group='state', failedConditions=['verification-lease-active'])
        output = ('NOTICE:  00000: BACI_RETIREMENT_STEP:scope-validation\n'
                  'NOTICE:  00000: BACI_RETIREMENT_GUARD:' + json.dumps(detail) + '\n'
                  'ERROR:  42501: checkout retirement state advanced\n'
                  'CONTEXT: secret=sk_test_do_not_print\n')
        self.assertEqual(safe_details(output), dict(retirementStep='scope-validation',
                         refusalReason='state-advanced', guard=detail))
        for unsafe in ('sk_test_do_not_print', ['verification-lease-active', 'secret'],
                       {'credential': 'secret'}):
            malformed = json.dumps(dict(group='state', failedConditions=unsafe))
            self.assertEqual(safe_details('NOTICE:  00000: BACI_RETIREMENT_GUARD:' + malformed), {})
        self.assertEqual(safe_details('ERROR:  42501: secret\n'
                                     'NOTICE:  00000: BACI_RETIREMENT_STEP:secret\n'), {})

    def test_refuses_unknown_sql_shape_before_execution(self):
        source = (HERE / 'checkout-retirement-apply.sql').read_text()
        with self.assertRaises(ValueError):
            annotate_state(source.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'), HERE)


if __name__ == '__main__':
    unittest.main()
