import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    'readiness_owner', Path(__file__).with_name('activation-readiness-owner.py'))
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)
QUERY = Path(__file__).with_name('activation-readiness.sql').read_text()


class ActivationReadinessTests(unittest.TestCase):
    def test_vps_launcher_pins_root_copies_before_isolated_python_execution(self):
        directory = Path(__file__).parent
        launcher = (directory / 'activation-readiness-vps.sh').read_text()
        for name in ('activation-readiness.sql', 'activation-readiness-owner.py'):
            self.assertIn(hashlib.sha256((directory / name).read_bytes()).hexdigest(), launcher)
        self.assertLess(launcher.index('/usr/bin/install'), launcher.index('/usr/bin/sha256sum'))
        self.assertLess(launcher.index('/usr/bin/sha256sum'), launcher.index('exec /usr/bin/python3 -I'))
        self.assertIn('/usr/bin/sudo /usr/bin/env -i', launcher)
        self.assertIn("' readiness \"$HERE\"", launcher)

    def test_sql_is_pinned_and_transaction_cannot_write(self):
        self.assertEqual(hashlib.sha256(QUERY.encode()).hexdigest(), OWNER.SQL_SHA256)
        self.assertTrue(QUERY.startswith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
        self.assertTrue(QUERY.endswith('ROLLBACK;\n'))
        self.assertLess(QUERY.index('staging_identity_refused'), QUERY.index("'goals'"))
        self.assertNotRegex(QUERY, r'(?i)\b(INSERT|UPDATE|DELETE|GRANT|ALTER|CREATE|COPY)\b')
        self.assertNotIn('email', QUERY)
        self.assertNotIn('rolpassword', QUERY)

    def test_queries_only_fixed_isolated_database_with_cleared_environment(self):
        calls = []

        def run(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return SimpleNamespace(returncode=0, stdout=json.dumps({
                'systemIdentifier': OWNER.SYSTEM_ID, 'readOnly': True}))

        OWNER.query_database(QUERY, run)
        arguments, kwargs = calls[0]
        self.assertEqual(arguments[3], 'baci-isolated-savings-db-1')
        self.assertEqual(arguments[-4:], ['-U', 'postgres', '-d', 'postgres'])
        self.assertNotIn('PGPASSWORD', kwargs['env'])
        self.assertEqual(kwargs['input'], QUERY)

    def test_wrong_database_and_writable_result_are_refused(self):
        for payload in ({'systemIdentifier': '123', 'readOnly': True},
                        {'systemIdentifier': OWNER.SYSTEM_ID, 'readOnly': False}, []):
            with self.subTest(payload=payload), self.assertRaises(OWNER.Refused):
                OWNER.query_database(QUERY, lambda *args, **kwargs: SimpleNamespace(
                    returncode=0, stdout=json.dumps(payload)))

    def test_database_error_does_not_expose_raw_values(self):
        with self.assertRaisesRegex(OWNER.Refused, '^database_read_refused$'):
            OWNER.query_database(QUERY, lambda *args, **kwargs: SimpleNamespace(
                returncode=1, stdout='password=private', stderr='providerSecret=private'))

    def test_network_inspection_does_not_request_environment_or_secret_mounts(self):
        calls = []

        def run(arguments, **kwargs):
            calls.append(arguments)
            return SimpleNamespace(returncode=0, stdout=json.dumps({
                'isolated': {'IPAddress': '172.25.0.2', 'Other': 'private'}}))

        self.assertEqual(OWNER.container_network(run), [
            {'network': 'isolated', 'address': '172.25.0.2'}])
        self.assertEqual(calls[0][3], '{{json .NetworkSettings.Networks}}')

    def test_non_root_refuses_before_database_or_file_access(self):
        with patch.object(OWNER.os, 'geteuid', return_value=501), \
                patch.object(OWNER, 'read_query') as reader:
            with self.assertRaisesRegex(OWNER.Refused, '^root_required$'):
                OWNER.inspect(Path('/tmp/anything'))
            reader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
