import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    'foundation_owner', Path(__file__).with_name('foundation-owner.py')
)
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


class FoundationOwnerTests(unittest.TestCase):
    def test_rejects_unsafe_file_attributes(self):
        valid = dict(st_mode=stat.S_IFREG | 0o400, st_uid=0, st_nlink=1, st_size=40)
        OWNER.validate_file(SimpleNamespace(**valid))
        for change in ({'st_uid': 501}, {'st_nlink': 2}, {'st_size': 0},
                       {'st_mode': stat.S_IFREG | 0o600},
                       {'st_mode': stat.S_IFLNK | 0o400}, {'st_size': 2_000_001}):
            with self.subTest(change=change), self.assertRaises(OWNER.Refused):
                OWNER.validate_file(SimpleNamespace(**(valid | change)))

    def test_refuses_changed_sql_before_database_command(self):
        with tempfile.TemporaryDirectory() as directory:
            selected = Path(directory) / 'foundation.sql'
            selected.write_text('BEGIN;\nCOMMIT;\n')
            with patch.object(OWNER, 'validate_file'):
                with self.assertRaises(OWNER.Refused):
                    OWNER.read_sql(selected, '0' * 64)

    def test_refuses_symlink_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'target.sql'
            target.write_text('BEGIN;\nCOMMIT;\n')
            selected = Path(directory) / 'foundation.sql'
            selected.symlink_to(target)
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            with self.assertRaises(OWNER.Refused):
                OWNER.read_sql(selected, digest)

    def test_executes_only_fixed_isolated_database_and_redacts_failure(self):
        calls = []

        def run(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return SimpleNamespace(returncode=1, stdout='private data', stderr='secret')

        with self.assertRaisesRegex(OWNER.Refused, '^database_apply_failed$'):
            OWNER.execute_sql('BEGIN;\nCOMMIT;\n', run)
        arguments, kwargs = calls[0]
        self.assertEqual(arguments[:4], ['/usr/bin/docker', 'exec', '-i',
                                       'baci-isolated-savings-db-1'])
        self.assertIn('--set=ON_ERROR_STOP=1', arguments)
        self.assertEqual(arguments[-4:], ['-U', 'postgres', '-d', 'postgres'])
        self.assertEqual(kwargs['env']['HOME'], '/root')
        self.assertNotIn('PGPASSWORD', kwargs['env'])
        self.assertEqual(kwargs['input'], 'BEGIN;\nCOMMIT;\n')

    def test_sql_reader_checks_content_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            selected = Path(directory) / 'foundation.sql'
            content = b'BEGIN;\nCOMMIT;\n'
            selected.write_bytes(content)
            with patch.object(OWNER, 'validate_file'):
                actual = OWNER.read_sql(selected, hashlib.sha256(content).hexdigest())
            self.assertEqual(actual, content.decode())

    def test_refuses_non_root_execution_without_database_call(self):
        with patch.object(OWNER.os, 'geteuid', return_value=501), \
             patch.object(OWNER, 'execute_sql') as execute:
            with self.assertRaisesRegex(OWNER.Refused, '^root_required$'):
                OWNER.install(Path('/tmp'), 'a' * 64)
            execute.assert_not_called()

    def test_root_cannot_select_an_unreviewed_sql_digest(self):
        with patch.object(OWNER.os, 'geteuid', return_value=0), \
             patch.object(OWNER, 'APPROVED_SQL_SHA256', 'a' * 64, create=True), \
             patch.object(OWNER, 'execute_sql') as execute:
            with self.assertRaisesRegex(OWNER.Refused, '^unapproved_sql_pin$'):
                OWNER.install(Path('/tmp'), 'b' * 64)
            execute.assert_not_called()

    def test_surfaces_only_machine_safe_prerequisite_failures(self):
        def run(*arguments, **kwargs):
            return SimpleNamespace(returncode=1, stdout='', stderr=(
                'ERROR: foundation_missing:public.merchants,'
                'foundation_conflict:prefunded_card_schema\n'
                'CONTEXT: private customer and secret values'))

        with self.assertRaises(OWNER.Refused) as captured:
            OWNER.execute_sql('BEGIN;\nCOMMIT;\n', run)
        self.assertEqual(captured.exception.checks, [
            'foundation_conflict:prefunded_card_schema',
            'foundation_missing:public.merchants'])

    def test_no_raw_database_message_enters_failure_details(self):
        def run(*arguments, **kwargs):
            return SimpleNamespace(returncode=1, stdout='', stderr='password=private')

        with self.assertRaises(OWNER.Refused) as captured:
            OWNER.execute_sql('BEGIN;\nCOMMIT;\n', run)
        self.assertEqual(captured.exception.checks, [])

    def test_postflight_rejects_wrong_identity_or_active_logins(self):
        baseline = {'systemIdentifier': OWNER.SYSTEM_IDENTIFIER, 'checkoutFunctions': 9,
                    'executorRoles': 3, 'unsafeRoles': 0, 'operations': 0,
                    'treasuryBindings': 0, 'checkoutIntents': 0}
        OWNER.verify_result(baseline)
        for change in ({'systemIdentifier': '123'}, {'checkoutFunctions': 8},
                       {'executorRoles': 2}, {'unsafeRoles': 1}, {'operations': 1},
                       {'treasuryBindings': 1}, {'checkoutIntents': 1}):
            with self.subTest(change=change), self.assertRaises(OWNER.Refused):
                OWNER.verify_result(baseline | change)


if __name__ == '__main__':
    unittest.main()
