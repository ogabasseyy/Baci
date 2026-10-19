from datetime import datetime, timezone
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import activation_contract as contract


class ActivationContractTests(unittest.TestCase):
    def test_separates_rollback_rehearsal_and_commit(self):
        source = b'BEGIN;\nSELECT 1;\n__FINISH__\n'
        pin = hashlib.sha256(source).hexdigest()
        self.assertTrue(contract.render_sql(source, pin).endswith('ROLLBACK;\n'))
        self.assertTrue(contract.render_sql(source, pin, True).endswith('COMMIT;\n'))

    def test_refuses_pin_drift_and_transaction_escape(self):
        with self.assertRaises(ValueError):
            contract.render_sql(b'BEGIN;\n__FINISH__', '0'*64)
        for source in (b'BEGIN;\nCOMMIT;\n__FINISH__', b'BEGIN;\n\\! bad\n__FINISH__'):
            with self.assertRaises(ValueError):
                contract.render_sql(source, hashlib.sha256(source).hexdigest())

    def test_deadline_has_no_late_activation_grace(self):
        contract.validate_window(datetime(2026, 10, 2, tzinfo=timezone.utc))
        with self.assertRaises(ValueError):
            contract.validate_window(datetime(2026, 10, 6, 15, 56, 10, tzinfo=timezone.utc))

    def test_deadline_stops_only_new_interest_runtime(self):
        files = contract.unit_files()
        self.assertIn(b'2026-10-06 15:59:10 UTC', files[contract.DEADLINE_TIMER])
        self.assertIn(b'baci-interest-replay.service', files[contract.DEADLINE_SERVICE])
        self.assertIn(b'baci-interest-replay', files[contract.DEADLINE_SERVICE])
        self.assertNotIn(b'prefunded', b''.join(files.values()))
        self.assertIn(str(contract.EPOCH).encode(), files[contract.SERVICE])
        self.assertNotIn(b'Restart=always', files[contract.SERVICE])

    def test_guard_never_enables_a_policy_or_general_ledger(self):
        source = Path(__file__).with_name('grant-bridge.sql').read_text()
        grants = [line for line in source.splitlines() if line.startswith('GRANT ')]
        self.assertEqual(grants, ['GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;',
                                 'GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'])
        self.assertNotIn('INSERT INTO', source)
        self.assertIn("IS DISTINCT FROM '{postgres=X/postgres,prefunded_treasury_operator=X/postgres}'", source)
        self.assertIn("IS DISTINCT FROM '{postgres=UC/postgres,prefunded_treasury_operator=U/postgres}'", source)
        self.assertIn('NOT inherit_option AND set_option', source)


if __name__ == '__main__':
    unittest.main()
