import hashlib
from pathlib import Path
import re
import unittest

from notification_contract import ROUTINES
from notification_database import readonly_sql, renewal_sql


DIRECTORY = Path(__file__).parent
QUERY = (DIRECTORY / 'notification-state-query.sql').read_text()
GUARD = (DIRECTORY / 'notification-role-guard.sql').read_text()
TEMPLATE = (DIRECTORY / 'notification-renewal.sql').read_text()


class NotificationDatabaseTests(unittest.TestCase):
    def test_expiry_only_sql_rehearsal_commit_and_restore_are_distinct(self):
        rehearsal = renewal_sql(TEMPLATE, QUERY, GUARD)
        committed = renewal_sql(TEMPLATE, QUERY, GUARD, commit=True)
        restore = renewal_sql(TEMPLATE, QUERY, GUARD, commit=True, restore=True)
        self.assertTrue(rehearsal.endswith('ROLLBACK;\n'))
        self.assertTrue(committed.endswith('COMMIT;\n'))
        self.assertIn("ALTER ROLE baci_savings_notifications_worker VALID UNTIL '2026-10-06T15:59:10Z';", committed)
        self.assertIn("ALTER ROLE baci_savings_notifications_worker VALID UNTIL '2026-09-29T15:59:10Z';", restore)
        self.assertNotIn('clock_timestamp()', restore)
        self.assertNotRegex(committed, r'(?im)^\s*(GRANT|REVOKE)\b|\bPASSWORD\b')
        self.assertNotRegex(committed, r'__[A-Z_]+__')

    def test_readonly_inspection_never_invokes_delivery_functions(self):
        query = readonly_sql(QUERY, GUARD)
        self.assertIn('BEGIN READ ONLY;', query)
        self.assertTrue(query.endswith('ROLLBACK;'))
        self.assertNotRegex(query, r'(?i)\b(SELECT|PERFORM|CALL)\s+savings_notifications\.')

    def test_protected_state_locks_password_privileges_and_financial_rows_before_change(self):
        self.assertLess(TEMPLATE.index('LOCK TABLE pg_catalog.pg_authid'), TEMPLATE.index('ALTER ROLE'))
        self.assertLess(TEMPLATE.index('notification_protected_before'), TEMPLATE.index('ALTER ROLE'))
        for relation in ('pg_auth_members', 'pg_proc', 'pg_namespace', 'pg_class', 'pg_database',
                         'savings_notifications.events', 'savings_notifications.deliveries',
                         'piggyvest_savings_ledger.postings', 'prefunded_card.operations'):
            self.assertIn(relation, TEMPLATE)
        self.assertIn("to_jsonb(role)-'rolvaliduntil'", TEMPLATE)
        self.assertIn('IS DISTINCT FROM pg_temp.notification_protected_state()', TEMPLATE)

    def test_routine_baselines_are_actual_append_only_migration_bodies(self):
        observed = {}
        for path in sorted((DIRECTORY.parents[3] / 'supabase' / 'migrations').glob('20260925130*.sql')):
            matches = re.finditer(r'CREATE FUNCTION savings_notifications\.(\w+)\((.*?)\)\s+RETURNS\s+.*?LANGUAGE (\w+).*?AS \$\$(.*?)\$\$;', path.read_text(), re.S)
            for match in matches:
                name, arguments, language, body = match.groups()
                types = [argument.strip().split()[1].replace('timestamptz', 'timestamp with time zone')
                         for argument in arguments.split(',') if argument.strip()]
                observed[name + '(' + ', '.join(types) + ')'] = (hashlib.md5(body.encode()).hexdigest(), language)
        self.assertEqual(observed, ROUTINES)


if __name__ == '__main__':
    unittest.main()
