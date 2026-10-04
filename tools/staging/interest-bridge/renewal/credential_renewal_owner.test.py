import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
specification = importlib.util.spec_from_file_location('renewal', DIRECTORY / 'credential_renewal_owner.py')
renewal = importlib.util.module_from_spec(specification)
specification.loader.exec_module(renewal)


class CredentialRenewal(unittest.TestCase):
    def setUp(self):
        self.content = (DIRECTORY / 'credential-renewal.sql').read_bytes()

    def test_rehearsal_changes_only_deadline_and_always_rolls_back(self):
        sql = renewal.render_sql(self.content)
        self.assertEqual(sql.count('BEGIN;'), 1)
        self.assertTrue(sql.endswith('ROLLBACK;\n'))
        self.assertNotIn('COMMIT;', sql)
        self.assertEqual(sql.count('ALTER ROLE '), 1)
        self.assertIn("VALID UNTIL '2026-10-06T15:59:10Z'", sql)
        self.assertNotIn('GRANT ', sql)
        self.assertNotIn('PASSWORD ', sql)
        self.assertIn("to_jsonb(role)-'rolvaliduntil'", sql)
        self.assertIn('credential_protected_state()', sql)

    def test_apply_requires_explicit_mode_and_one_commit(self):
        sql = renewal.render_sql(self.content, apply=True)
        self.assertEqual(sql.count('COMMIT;'), 1)
        self.assertNotIn('ROLLBACK;', sql)

    def test_changed_sql_is_refused_before_database_contact(self):
        with self.assertRaises(ValueError):
            renewal.render_sql(self.content.replace(b'10000', b'99999'))

    def test_expected_system_role_expiry_and_retirement_are_guarded(self):
        sql = renewal.render_sql(self.content)
        for marker in ('7685292944002592802', 'inet_client_addr() IS NOT NULL',
                       "rolvaliduntil='2026-09-29T15:59:10Z'", "phase='retired_unconfirmed'",
                       'reserved_kobo=0 AND consumed_kobo=0', 'md5(prosrc)',
                       "current_amount=100", 'interest_allocations)<>0', 'interest_receipts)<>0'):
            self.assertIn(marker, sql)

    def test_no_unbounded_retry_or_database_provider_mutation_commands(self):
        sql = renewal.render_sql(self.content)
        for marker in ('INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE ROLE', 'GRANT ', 'REVOKE '):
            self.assertNotIn(marker, sql)

    def containers(self):
        return [dict(Name='/' + name, State=dict(Running=False, Paused=False, Restarting=False, Status='created'),
                     HostConfig=dict(RestartPolicy=dict(Name='no'))) for name in renewal.CONTAINERS]

    def check_runtimes(self, containers, service='inactive'):
        import json
        with patch.object(renewal, 'command', side_effect=[json.dumps(containers)] + [service] * len(renewal.SERVICES)):
            renewal.stopped_runtimes()

    def test_all_stopped_financial_runtimes_pass_without_start(self):
        self.check_runtimes(self.containers())

    def test_running_or_restartable_container_blocks_renewal(self):
        for section, field, value in [('State', 'Running', True), ('State', 'Paused', True),
                                      ('State', 'Restarting', True), ('State', 'Status', 'running')]:
            containers = self.containers()
            containers[0][section][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check_runtimes(containers)
        containers = self.containers()
        containers[0]['HostConfig']['RestartPolicy']['Name'] = 'always'
        with self.assertRaises(ValueError):
            self.check_runtimes(containers)

    def test_active_systemd_financial_service_blocks_renewal(self):
        with self.assertRaises(ValueError):
            self.check_runtimes(self.containers(), 'active')

    def test_subprocess_error_never_leaks_database_error_text(self):
        result = SimpleNamespace(returncode=1, stdout='private secret', stderr='private password')
        with patch.object(renewal.subprocess, 'run', return_value=result), self.assertRaisesRegex(ValueError, '^Reviewed command refused$'):
            renewal.command(['database'])


if __name__ == '__main__':
    unittest.main()
