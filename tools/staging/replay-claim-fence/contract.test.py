import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('claim_contract_tests', HERE / 'contract.py')
contract = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(contract)


class ContractTests(unittest.TestCase):
    def test_expiry_is_exact_october_six_deadline(self):
        self.assertEqual(datetime.fromtimestamp(contract.EXPIRY, timezone.utc).isoformat(),
                         '2026-10-06T15:59:10+00:00')

    def test_wrong_definition_refuses(self):
        for source in ('', 'CREATE OR REPLACE FUNCTION wrong()', None, b'not-text'):
            with self.subTest(source=source):
                with self.assertRaisesRegex(ValueError, 'definition_pin_refused'):
                    contract.validate(source, 'rollback')

    def test_unknown_transaction_mode_refuses(self):
        with self.assertRaisesRegex(ValueError, 'transaction_mode_refused'):
            contract.validate('', 'apply')

    def test_expired_render_refuses_with_test_private_datetime_mock(self):
        with patch.object(contract, 'datetime') as clock:
            clock.now.return_value = datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)
            with self.assertRaisesRegex(ValueError, 'deadline_expired'):
                contract.validate('', 'rollback')

    def test_public_clock_override_is_not_accepted(self):
        with self.assertRaises(TypeError):
            contract.validate('', 'rollback', now=datetime.now(timezone.utc))


if __name__ == '__main__':
    unittest.main()
