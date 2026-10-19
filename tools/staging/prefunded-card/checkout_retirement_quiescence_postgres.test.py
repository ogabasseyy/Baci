import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import checkout_retirement_quiescence as quiescence


HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('drain_transaction_fixture', HERE / 'checkout_retirement_transaction.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class LeaseDrainPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_type = FIXTURE.CheckoutRetirementTransactionTests
        fixture_type.setUpClass()
        cls.addClassCleanup(fixture_type.doClassCleanups)
        cls.fixture = fixture_type()

    def test_actual_active_lease_refuses_then_natural_expiry_allows_unchanged_retirement(self):
        fixture = self.fixture
        operation = fixture.intent['intentId']
        fixture.query("UPDATE prefunded_card.operations SET verification_lease_expires_at="
                      f"clock_timestamp()+interval '60 seconds' WHERE id='{operation}'")
        before = fixture.snapshot()
        with self.assertRaises(subprocess.CalledProcessError) as refusal:
            fixture.query(fixture.render(before, rehearsal=True))
        self.assertIn('checkout retirement state advanced', refusal.exception.stderr)

        fixture.query("UPDATE prefunded_card.operations SET verification_lease_expires_at="
                      f"clock_timestamp()+interval '1 second' WHERE id='{operation}'")
        leased = fixture.persisted_state()
        calls = []

        def read_only_command(arguments, input_text, timeout):
            self.assertTrue(input_text.startswith('BEGIN READ ONLY;'))
            self.assertTrue(input_text.rstrip().endswith('ROLLBACK;'))
            self.assertNotRegex(input_text, r'\b(?:UPDATE|DELETE|INSERT|COMMIT)\b')
            calls.append(input_text)
            return fixture.query(input_text)

        with patch.multiple(quiescence, INTENT=operation, SYSTEM=fixture.scope['systemIdentifier']), \
                patch.object(quiescence, 'command', side_effect=read_only_command):
            quiescence._drain_leases()
        self.assertGreaterEqual(len(calls), 1)
        self.assertEqual(fixture.persisted_state(), leased)
        self.assertEqual(fixture.snapshot(), before)
        result = json.loads(fixture.query(fixture.render(before, rehearsal=True)))
        self.assertEqual(result['status'], 'retired_unconfirmed')
        self.assertEqual(result['releasedKobo'], 10000)
        self.assertEqual(fixture.persisted_state(), leased)
        self.assertEqual(fixture.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
