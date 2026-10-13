import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('provision-runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_interest_is_explicitly_opted_in_not_enabled_by_default(self):
        arguments = ['--goal', '430314fd-cd8b-4579-98d4-e9f345713dd6', '--provision']
        self.assertFalse(runner.parse_arguments(arguments).enable_interest_accrual)
        self.assertTrue(runner.parse_arguments(arguments + ['--enable-interest-accrual']).enable_interest_accrual)

    def test_mapped_wallet_without_verified_interest_refuses_before_journal_or_database_writes(self):
        goal = '430314fd-cd8b-4579-98d4-e9f345713dd6'
        source = {
            'walletId': '01M2T3PCEDE2MGF2S7Y5T49H01',
            'providerCustomerId': 'c096507d-dc32-45d2-9c01-871a27abfd10',
            'existing': '01M3CQX27G9687EFSF1TKYMPR9',
        }
        base = {
            'business_id': runner.provision.BUSINESS,
            'api_customer_id': '01M2T3PAHG3P5A32REX8MH3HD7',
            'currency': 'NGN', 'status': 'active', 'balance': 10000,
        }
        old_wallet = {**base, 'id': source['walletId']}
        existing_wallet = {
            **base, 'id': source['existing'],
            'name': runner.provision.wallet_name(runner.provision.INTEGRATION, goal),
            'interest_enabled': False,
        }
        opener = Mock()
        opener.open.side_effect = [
            io.BytesIO(json.dumps({'data': old_wallet}).encode()),
            io.BytesIO(json.dumps({'data': existing_wallet}).encode()),
        ]
        with patch('sys.argv', ['runner', '--goal', goal, '--provision', '--enable-interest-accrual']), \
                patch.object(runner.time, 'time', return_value=runner.provision.EXPIRY - 100), \
                patch.object(runner, 'sql', side_effect=[runner.provision.CLUSTER, json.dumps(source)]) as database, \
                patch.object(runner, 'intake_config', return_value={'providerSecret': 'synthetic'}), \
                patch.object(runner.urllib.request, 'build_opener', return_value=opener), \
                patch.object(runner.Path, 'mkdir') as create_directory:
            with self.assertRaisesRegex(RuntimeError, 'Existing wallet interest accrual is not verified'):
                runner.main()
        create_directory.assert_not_called()
        self.assertEqual(len(database.call_args_list), 2)
        self.assertTrue(all(call.args[0].get_method() == 'GET' for call in opener.open.call_args_list))

    def test_database_execution_is_pinned_to_isolated_container(self):
        with patch.object(runner.subprocess, 'run', return_value=Mock(returncode=0, stdout='result')) as command:
            self.assertEqual(runner.sql('SELECT 1'), 'result')
            self.assertEqual(command.call_args.args[0][:4], ['docker', 'exec', '-i', 'baci-isolated-savings-db-1'])

    def test_database_failure_never_prints_raw_response(self):
        with patch.object(runner.subprocess, 'run', return_value=Mock(returncode=1, stderr='secret error')):
            with self.assertRaisesRegex(RuntimeError, '^Isolated database operation refused$'):
                runner.sql('SELECT 1')

    def test_private_input_refuses_symlinks_hardlinks_and_world_readability(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret.json'
            path.write_text(json.dumps({'value': 'synthetic'}))
            os.chmod(path, 0o600)
            self.assertEqual(runner.private_read(path), {'value': 'synthetic'})
            link = Path(directory) / 'link'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                runner.private_read(link)
            link.unlink()
            os.link(path, link)
            with self.assertRaises(RuntimeError):
                runner.private_read(path)
            link.unlink()
            os.chmod(path, 0o644)
            with self.assertRaises(RuntimeError):
                runner.private_read(path)

    def test_provider_redirect_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'redirect refused'):
            runner.NoRedirect().redirect_request(None)


if __name__ == '__main__':
    unittest.main()
