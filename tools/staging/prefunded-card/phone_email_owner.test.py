import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import phone_email_owner as owner
import phone_email_contract as contract
from treasury_owner_contract import Refused


class EmailOwnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.phone = self.root / 'phone.env'
        self.phone.write_bytes(b'STAGING_PHONE_EMAIL=old@example.invalid\nSTAGING_PHONE_PASSWORD=keep-this-password\n')
        self.phone.chmod(0o600)
        self.audit = self.root / 'audit'
        self.initial = dict(scope=True, collision=False, authId=contract.ACTOR, identityCount=1,
                            identityMatches=True, principalKobo=10000, protected='financial-and-password-proof',
                            authEmailSha=contract.digest(b'old@example.invalid'), customerEmailSha=contract.digest(b'old@example.invalid'))
        self.state = dict(self.initial)
        self.calls = []

    def http(self, url, method, body=None, headers=None):
        self.calls.append((url, method, body))
        if '/admin/users/' in url:
            self.assertEqual(body, {'email': contract.EMAIL, 'email_confirm': True})
            self.state['authEmailSha'] = contract.digest(contract.EMAIL.encode())
            return {'id': contract.ACTOR, 'email': contract.EMAIL}
        if '/rest/v1/customers?' in url:
            return [{'id': contract.CUSTOMER, 'merchant_id': contract.MERCHANT, 'user_id': contract.ACTOR, 'email': contract.EMAIL}]
        if '/rest/v1/customer_savings_goals?' in url:
            return [{'id': contract.GOAL, 'merchant_id': contract.MERCHANT, 'customer_id': contract.CUSTOMER, 'current_amount': 100}]
        raise AssertionError('Unexpected endpoint')

    def database(self, sql):
        self.calls.append(('database', sql))
        self.state['customerEmailSha'] = contract.digest(contract.EMAIL.encode())
        return ''

    def run_owner(self, http=None):
        account = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
        original_reader = owner.read_file
        def read(path, uid, mode, limit):
            return original_reader(path, os.getuid(), mode, limit) if path != owner.PROFILE else b'profile'
        with patch.object(owner, 'PHONE', self.phone), patch.object(owner, 'AUDIT', self.audit), \
             patch.object(owner.os, 'geteuid', return_value=0), patch.object(owner.time, 'time', return_value=1790600000), \
             patch.object(owner.pwd, 'getpwnam', return_value=account), \
             patch.object(owner, 'read_file', side_effect=read), patch.object(owner, 'root_ancestors'), \
             patch.object(owner, 'private_directory'), patch.object(owner, 'profile', return_value='public-key'), \
             patch.object(contract, 'OLD_EMAIL_SHA', self.initial['authEmailSha']), \
             patch.object(owner, 'probe', side_effect=lambda sql: dict(self.state)), \
             patch.object(owner, 'admin_connection', return_value=('http://172.23.0.3:9999', 'private-admin')), \
             patch.object(owner, 'login', return_value='private-access') as login, \
             patch.object(owner, 'database', side_effect=self.database), \
             patch.object(owner, 'request_json', side_effect=http or self.http), patch('builtins.print') as output:
            result = owner.run()
            return result, login.call_args_list, output.call_args_list

    def test_changes_email_only_and_rerun_does_not_repeat_auth_or_customer_updates(self):
        original = self.phone.read_bytes()
        result, logins, output = self.run_owner()
        self.assertEqual(result, 0)
        self.assertEqual(self.phone.read_bytes(), original.replace(b'old@example.invalid', contract.EMAIL.encode()))
        self.assertEqual(logins[-1].args[:2], (contract.EMAIL, 'keep-this-password'))
        self.assertIn('STAGING_PHONE_EMAIL_UPDATED', str(output))
        self.calls.clear()
        result, _, _ = self.run_owner()
        self.assertEqual(result, 0)
        self.assertTrue(all(len(call) == 3 and call[1] == 'GET' for call in self.calls))

    def test_timed_out_admin_update_is_reconciled_before_rerun(self):
        def timeout_after_commit(url, method, body=None, headers=None):
            self.http(url, method, body, headers)
            raise TimeoutError('Secret details must not be logged')
        result, _, output = self.run_owner(timeout_after_commit)
        self.assertEqual(result, 1)
        self.assertNotIn('Secret details', str(output))
        self.assertEqual(self.state['customerEmailSha'], self.initial['customerEmailSha'])
        self.assertIn(b'old@example.invalid', self.phone.read_bytes())
        self.calls.clear()
        self.assertEqual(self.run_owner()[0], 0)
        self.assertFalse(any('/admin/users/' in call[0] for call in self.calls))

    def test_financial_drift_refuses_before_any_resumed_mutation(self):
        self.assertEqual(self.run_owner()[0], 0)
        self.calls.clear()
        self.state['protected'] = 'changed'
        self.assertEqual(self.run_owner()[0], 1)
        self.assertEqual(self.calls, [])

    def test_collision_refuses_before_admin_request(self):
        self.state['collision'] = True
        self.assertEqual(self.run_owner()[0], 1)
        self.assertEqual(self.calls, [])

    def test_symlink_fixture_is_refused(self):
        target = self.root / 'target.env'
        self.phone.rename(target)
        self.phone.symlink_to(target)
        self.assertEqual(self.run_owner()[0], 1)
        self.assertEqual(self.calls, [])

    def test_customer_write_failure_leaves_backup_and_rerun_can_complete(self):
        with patch.object(self, 'database', side_effect=Refused('write uncertain')):
            self.assertEqual(self.run_owner()[0], 1)
        self.assertTrue((self.audit / 'baseline.json').exists())
        self.assertEqual(self.run_owner()[0], 0)

    def test_endpoint_guard_refuses_payment_and_production_requests(self):
        for url in ('https://api.paystack.co/transaction/initialize', 'https://ogabassey.com/auth/v1/token'):
            with self.assertRaises(Refused):
                owner.request_json(url, 'POST', {})

    def test_admin_endpoint_rejects_public_and_link_local_addresses(self):
        for address in ('8.8.8.8', '169.254.169.254'):
            with self.assertRaises(Refused):
                owner.request_json('http://' + address + ':9999/admin/users/' + contract.ACTOR, 'PUT', {})

    def test_admin_connection_requires_isolated_auth_and_database_network(self):
        def container(service):
            return {'Config': {'Labels': {'com.docker.compose.project': 'baci-isolated-savings',
                                         'com.docker.compose.service': service}, 'Env': [
                'GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:fixture@db:5432/postgres',
                'GOTRUE_JWT_ISSUER=' + contract.ORIGIN + '/auth/v1', 'GOTRUE_API_PORT=9999',
                'GOTRUE_JWT_ADMIN_ROLES=service_role', 'GOTRUE_JWT_SECRET=' + '1' * 64]},
                'NetworkSettings': {'Networks': {'baci-isolated-savings_database': {
                    'NetworkID': 'isolated-network', 'IPAddress': '172.23.0.3'}}}}
        auth, database = container('auth'), container('db')
        with patch.object(owner, 'inspect', side_effect=[auth, database]):
            origin, token = owner.admin_connection()
        self.assertEqual(origin, 'http://172.23.0.3:9999')
        self.assertEqual(len(token.split('.')), 3)
        database['NetworkSettings']['Networks']['baci-isolated-savings_database']['NetworkID'] = 'different'
        with patch.object(owner, 'inspect', side_effect=[auth, database]), self.assertRaises(Refused):
            owner.admin_connection()

    def test_tampered_staged_bytes_are_rejected_before_replacing_live_fixture(self):
        original = self.phone.read_bytes()
        account = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
        original_fsync = os.fsync
        def tamper(descriptor):
            original_fsync(descriptor)
            for staged in self.root.glob('.staging-phone-email-*/*'):
                staged.write_bytes(b'tampered')
        with patch.object(owner, 'PHONE', self.phone), patch.object(owner.os, 'fsync', side_effect=tamper):
            with self.assertRaises(Refused):
                owner.replace_fixture(original, b'approved replacement', account)
        self.assertEqual(self.phone.read_bytes(), original)

    def test_substituted_user_accessible_staging_directory_is_refused_before_write(self):
        original = self.phone.read_bytes()
        account = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
        substitute = self.root / 'substitute'
        substitute.mkdir(mode=0o755)
        with patch.object(owner, 'PHONE', self.phone), patch.object(owner.tempfile, 'mkdtemp', return_value=str(substitute)):
            with self.assertRaises(Refused):
                owner.replace_fixture(original, b'approved replacement', account)
        self.assertEqual(self.phone.read_bytes(), original)
        self.assertEqual(list(substitute.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
