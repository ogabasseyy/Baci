import importlib.util
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).with_name('renewal_inventory.py')
MODULE = None
if SOURCE.exists():
    SPEC = importlib.util.spec_from_file_location('renewal_inventory', SOURCE)
    MODULE = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(MODULE)


class RenewalInventoryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(MODULE, 'Read-only renewal inventory is not implemented')

    def test_deadline_projection_does_not_include_credentials_or_unapproved_values(self):
        value = {
            'checkout': {'scope': {'expiresAt': '2026-09-29T15:59:10Z'}, 'secret': 'never-print'},
            'password': '2026-09-29T15:59:10Z',
            'expiresAt': 'never-print',
            'maximumAmountKobo': 10000,
        }
        result = MODULE.deadline_fields(value)
        self.assertEqual(result, {'expiresAt': ['2026-09-29T15:59:10Z']})
        self.assertNotIn('never-print', json.dumps(result))

    def test_secret_shaped_ancestor_keys_are_never_echoed_and_depth_is_bounded(self):
        value = {'never_print_secret': {'expiresAt': '2026-09-29T15:59:10Z'}}
        self.assertEqual(MODULE.deadline_fields(value), {'expiresAt': ['2026-09-29T15:59:10Z']})
        for _ in range(20):
            value = {'nested': value}
        with self.assertRaises(ValueError):
            MODULE.deadline_fields(value)

    def test_file_inventory_hashes_bytes_without_printing_them(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'config.json'
            target.write_text('{"expiresAt":"2026-09-29T15:59:10Z","secret":"never-print"}')
            target.chmod(0o600)
            result = MODULE.file_inventory(target)
        self.assertEqual(result['deadlines'], {'expiresAt': ['2026-09-29T15:59:10Z']})
        self.assertEqual(len(result['sha256']), 64)
        self.assertNotIn('never-print', json.dumps(result))

    def test_only_numeric_jwt_expiry_is_projected_never_token_or_other_claims(self):
        claims = base64.urlsafe_b64encode(json.dumps({'exp': 1790697550, 'secret': 'never-print'}).encode()).decode().rstrip('=')
        token = 'eyJhbGciOiJIUzI1NiJ9.' + claims + '.test-signature'
        result = MODULE.jwt_expiry_fields({'appToken': token, 'password': token})
        self.assertEqual(result, {'appToken': [1790697550]})
        self.assertNotIn('never-print', json.dumps(result))
        self.assertEqual(MODULE.jwt_expiry_fields({'appToken': 'malformed'}), {})

    def test_anon_key_expiry_is_read_only_from_the_exact_public_anon_config(self):
        claims = base64.urlsafe_b64encode(json.dumps({'exp': 1790697550, 'secret': 'never-print'}).encode()).decode().rstrip('=')
        token = 'eyJhbGciOiJIUzI1NiJ9.' + claims + '.test-signature'
        value = {'url': 'https://staging-auth.ogabassey.com', 'key': token, 'nested': {'key': token}}
        result = MODULE.jwt_expiry_fields(value, source=Path('/opt/baci-prefunded-public/config/anon.json'))
        self.assertEqual(result, {'key': [1790697550]})
        self.assertEqual(MODULE.jwt_expiry_fields(value, source=Path('/somewhere/anon.json')), {})
        self.assertEqual(MODULE.jwt_expiry_fields(value), {})
        self.assertNotIn('never-print', json.dumps(result))
        self.assertNotIn(token, json.dumps(result))

    def test_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'target'
            target.write_text('never-print')
            link = Path(temporary) / 'link'
            link.symlink_to(target)
            result = MODULE.file_inventory(link)
        self.assertEqual(result['status'], 'unsafe')
        self.assertNotIn('sha256', result)

    def test_hardlink_and_group_writable_file_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'target'
            target.write_text('never-print')
            target.chmod(0o600)
            link = Path(temporary) / 'link'
            os.link(target, link)
            self.assertEqual(MODULE.file_inventory(target)['status'], 'unsafe')
            link.unlink()
            target.chmod(0o660)
            self.assertEqual(MODULE.file_inventory(target)['status'], 'unsafe')

    def test_missing_input_is_reported_without_creating_anything(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'absent'
            self.assertEqual(MODULE.file_inventory(target), {'path': str(target), 'status': 'missing'})
            self.assertFalse(target.exists())

    def test_database_inventory_refuses_crossed_database_identity_or_writable_session(self):
        arguments = ('pvb-staging-receipts-db', 'psql', 'supabase_admin',
                     'renewal-inventory.sql', MODULE.RECEIPT_SYSTEM)
        for report in ({'systemIdentifier': MODULE.SYSTEM, 'readOnly': True},
                       {'systemIdentifier': MODULE.RECEIPT_SYSTEM, 'readOnly': False}):
            with patch.object(MODULE, 'command', return_value=json.dumps(report)):
                with self.assertRaises(RuntimeError):
                    MODULE.database_inventory(*arguments)
        expected = {'systemIdentifier': MODULE.RECEIPT_SYSTEM, 'readOnly': True}
        with patch.object(MODULE, 'command', return_value=json.dumps(expected)) as command:
            self.assertEqual(MODULE.database_inventory(*arguments), expected)
        self.assertIn('pvb-staging-receipts-db', command.call_args.args[0])
        self.assertTrue(command.call_args.args[1].startswith('BEGIN READ ONLY;'))

    def test_database_script_is_read_only_with_exact_physical_database_pin(self):
        sql = SOURCE.with_name('renewal-inventory.sql').read_text()
        self.assertTrue(sql.startswith('BEGIN READ ONLY;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
        self.assertIn("'7685292944002592802'", sql)
        self.assertNotRegex(sql.upper(), r'\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b')


if __name__ == '__main__':
    unittest.main()
