import importlib.util
from pathlib import Path
import unittest


specification = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('activation-inventory.py'))
inventory = importlib.util.module_from_spec(specification)
specification.loader.exec_module(inventory)


class Helper:
    @staticmethod
    def summarize_wallet(data, wallet):
        if data['id'] != wallet:
            raise ValueError('identity')
        return dict(id=wallet, interest_enabled=data.get('interest_enabled'))


class InventoryTests(unittest.TestCase):
    def test_keeps_provider_identifiers_exact_and_interest_unknown(self):
        result = inventory.wallet_summary(Helper, dict(id='wallet-A', type='api', api_customer_id='customer-UUID'))
        self.assertEqual(result['api_customer_id'], 'customer-UUID')
        self.assertIsNone(result['interest_enabled'])

    def test_refuses_non_api_wallet(self):
        with self.assertRaises(ValueError):
            inventory.wallet_summary(Helper, dict(id='wallet-A', type='business'))

    def test_refuses_non_scalar_identifier(self):
        with self.assertRaises(ValueError):
            inventory.wallet_summary(Helper, dict(id='wallet-A', type='api', customer_id={'id': 'customer'}))


if __name__ == '__main__':
    unittest.main()
