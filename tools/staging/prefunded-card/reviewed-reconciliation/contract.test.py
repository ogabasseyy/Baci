import copy
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import contract
from test_support import bundle, fixture_pin


class ContractTests(unittest.TestCase):
    def test_validate_rejects_unexpected_public_now_keyword(self):
        value = bundle()
        with fixture_pin()[0], self.assertRaisesRegex(TypeError, "unexpected keyword argument 'now'"):
            contract.validate(value, contract.digest(value), now=None)

    def test_original_production_pin_has_no_public_override(self):
        value = bundle()
        with self.assertRaisesRegex(ValueError, 'original_source_pin'):
            contract.validate(value, contract.digest(value))

    def test_exact_typed_scope_collection_and_fresh_independent_proof(self):
        value = bundle()
        with fixture_pin()[0]:
            self.assertEqual(contract.validate(value, contract.digest(value)), value)
            for field, key, replacement in (
                    ('scope', 'systemIdentifier', '1'), ('scope', 'merchantId', contract.INTENT),
                    ('selection', 'goalId', contract.OLD_GOAL), ('collection', 'amountKobo', 9999),
                    ('collection', 'amountKobo', True), ('proof', 'independentlyVerified', False),
                    ('proof', 'domain', 'live'), ('proof', 'channel', 'bank'),
                    ('proof', 'collectionSha256', 'f' * 64)):
                changed = copy.deepcopy(value)
                changed[field][key] = replacement
                with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                    contract.validate(changed, contract.digest(changed))
            for offset in (-61, 1):
                changed = copy.deepcopy(value)
                now = datetime.now(timezone.utc)
                changed['proof']['verifiedAt'] = (now + timedelta(seconds=offset)).isoformat().replace('+00:00', 'Z')
                with patch('contract.datetime', wraps=datetime) as clock:
                    clock.now.return_value = now
                    with self.assertRaises(ValueError):
                        contract.validate(changed, contract.digest(changed))

    def test_wrong_review_pin_and_fixed_deadline_refuse(self):
        value = bundle()
        with fixture_pin()[0]:
            with self.assertRaisesRegex(ValueError, 'reviewed_bundle_pin'):
                contract.validate(value, 'f' * 64)
            deadline = contract.timestamp(contract.DEADLINE)
            with patch('contract.datetime', wraps=datetime) as clock:
                clock.now.return_value = deadline
                with self.assertRaisesRegex(ValueError, 'deadline'):
                    contract.validate(value, contract.digest(value))


if __name__ == '__main__':
    unittest.main()
