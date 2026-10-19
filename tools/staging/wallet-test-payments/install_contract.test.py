import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wallet_test_install_contract', Path(__file__).with_name('install_contract.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InstallContractTests(unittest.TestCase):
    def test_refuses_occupied_port_without_touching_existing_listener(self):
        with patch.object(MODULE.socket, 'socket') as socket:
            listener = socket.return_value.__enter__.return_value
            listener.bind.side_effect = OSError('occupied')
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.verify_payment_port()
            listener.bind.assert_called_once_with(('127.0.0.1', 4897))

    def test_runtime_config_refuses_multiple_customers_for_singleton_database_config(self):
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.validate_public_config({
                'authOrigin': 'https://staging-auth.ogabassey.com',
                'apiOrigin': 'https://staging.ogabassey.com', 'anonKey': 'public',
                'merchantId': MODULE.FIXTURE_MERCHANT,
                'customerIds': ['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'],
            })


if __name__ == '__main__':
    unittest.main()
