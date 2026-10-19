from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('complete_contract_tests', HERE / 'contract.py')
contract = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(contract)


class ContractTests(unittest.TestCase):
    def test_fixed_expiry_is_october_six(self):
        self.assertEqual(datetime.fromtimestamp(contract.EXPIRY, timezone.utc).isoformat(),
                         '2026-10-06T15:59:10+00:00')

    def test_private_json_rejects_duplicates_nonfinite_invalid_utf8_and_empty(self):
        for content in (b'{"key":1,"key":2}', b'{"key":NaN}', b'\xff', b'', None):
            with self.subTest(content=content):
                with self.assertRaisesRegex(ValueError, '^private_json_refused$'):
                    contract.private_json(content)

    def test_canonical_digest_is_key_order_independent(self):
        self.assertEqual(contract.digest({'first': 1, 'second': 2}),
                         contract.digest({'second': 2, 'first': 1}))

    def test_expired_contract_refuses(self):
        with patch.object(contract, 'datetime') as clock:
            clock.now.return_value = datetime.fromtimestamp(contract.EXPIRY, timezone.utc)
            with self.assertRaisesRegex(ValueError, 'fixed_deadline_expired'):
                contract.instant()

    def test_public_clock_override_is_not_accepted(self):
        with self.assertRaises(TypeError):
            contract.instant(now=1)


if __name__ == '__main__':
    unittest.main()
