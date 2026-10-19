import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wallet_test_install_database', Path(__file__).with_name('install_database.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DatabaseInstallTests(unittest.TestCase):
    def test_generates_noninteractive_urlsafe_database_password(self):
        with patch.object(MODULE.secrets, 'token_urlsafe', return_value='generated-password') as token:
            self.assertEqual(MODULE.generate_password(), 'generated-password')
        token.assert_called_once_with(48)

    def test_provision_sends_password_only_on_psql_standard_input(self):
        completed = subprocess.CompletedProcess([], 0, 'BACI_TEST_PAYMENTS_PROVISIONED\n', '')
        config = {'merchantId': MODULE.FIXTURE_MERCHANT, 'customerIds': [MODULE.FIXTURE_CUSTOMER]}
        with patch.object(MODULE.subprocess, 'run', return_value=completed) as run:
            MODULE.provision(b'SELECT 1;', config, 'generated-password')
        arguments, options = run.call_args
        self.assertEqual(arguments[0], [
            '/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1', 'psql',
            '-U', 'postgres', '-d', 'postgres', '-XqAt', '-vON_ERROR_STOP=1',
        ])
        self.assertNotIn('generated-password', arguments[0])
        self.assertIn("ALTER ROLE baci_staging_test_payments PASSWORD 'generated-password'", options['input'])
        self.assertTrue(options['input'].startswith('BEGIN;'))
        self.assertIn('SELECT 1;', options['input'])
        self.assertIn('COMMIT;', options['input'])
        self.assertNotIn('stdin', options)

    def test_topup_recovery_probe_uses_dynamic_sql_and_rejects_unknown_output(self):
        with patch.object(MODULE, '_run', return_value='ZERO') as run:
            self.assertFalse(MODULE.has_topups())
        self.assertIn('EXECUTE', run.call_args.args[0])
        self.assertIn("to_regclass('staging_wallet_payments.pending_topups')", run.call_args.args[0])
        with patch.object(MODULE, '_run', return_value='unexpected'):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.has_topups()


if __name__ == '__main__':
    unittest.main()
