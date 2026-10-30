import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import threading
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
MIGRATIONS = DIRECTORY.parents[1] / 'supabase/migrations'
SPEC = importlib.util.spec_from_file_location(
    'savings_notifications_postgres',
    DIRECTORY / 'savings-notifications-postgres.test.py',
)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class SavingsNotificationsPostgresRunnerTests(unittest.TestCase):
    def run_harness(self):
        statements = []
        commands = []
        lock = threading.Lock()
        claims = 0

        def run(command, **options):
            nonlocal claims
            with lock:
                commands.append(command)
                source = options.get('input', '')
                statements.append(source)
                if source == 'SELECT count(*) FROM savings_notifications.claim_push(1);':
                    claims += 1
                    output = '1' if claims == 1 else '0'
                elif "WHERE status='dispatching'" in source:
                    output = '1'
                else:
                    output = '0'
                return subprocess.CompletedProcess(command, 0, stdout=output)

        with patch('sys.argv', ['runner', '--container', 'supabase_db_notification_fixture']), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()):
            try:
                RUNNER.main()
            except FileNotFoundError as error:
                self.fail(f'Harness references a missing SQL file: {error.filename}')
        return statements, commands

    def test_loads_existing_storage_migration_instead_of_nonexistent_timestamp(self):
        statements, commands = self.run_harness()

        storage = (MIGRATIONS / '20260925130050_customer_savings_engagement_storage.sql').read_text()
        self.assertIn(storage, statements)
        created = next(command[-1] for command in commands if 'createdb' in command)
        dropped = next(command[-1] for command in commands if 'dropdb' in command)
        self.assertTrue(created.startswith('baci_engagement_test_'))
        self.assertEqual(created, dropped)

    def test_applies_retry_migrations_before_current_contract_and_concurrent_claims(self):
        statements, _commands = self.run_harness()
        names = [
            '20261004130000_push_retryable_outcome.sql',
            '20261004140000_claim_push_tokenless_retry.sql',
            '20261004150000_push_retry_schedule.sql',
            '20261004171000_finish_push_unregistered.sql',
            '20261006080000_push_delivery_retry_backoff.sql',
        ]

        for name in names:
            self.assertTrue((MIGRATIONS / name).read_text() in statements,
                            f'Harness omitted retry migration: {name}')
        positions = [statements.index((MIGRATIONS / name).read_text()) for name in names]
        self.assertEqual(positions, sorted(positions))
        legacy = (MIGRATIONS / 'tests/customer_savings_engagement.sql').read_text()
        self.assertLess(positions[0], statements.index(legacy))
        self.assertLess(statements.index(legacy), positions[1])
        current = (DIRECTORY / 'savings-notifications-current.sql').read_text()
        self.assertLess(positions[-1], statements.index(current))
        concurrent = (MIGRATIONS / 'tests/customer_savings_engagement_concurrency.sql').read_text()
        self.assertLess(statements.index(current), statements.index(concurrent))
        self.assertLess(statements.index(concurrent), statements.index(
            'SELECT count(*) FROM savings_notifications.claim_push(1);'
        ))

    def test_rejects_non_disposable_container_before_database_commands(self):
        with patch('sys.argv', ['runner', '--container', 'shared-staging']), \
                patch.object(RUNNER.subprocess, 'run') as run, \
                contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                RUNNER.main()

        self.assertEqual(raised.exception.code, 2)
        run.assert_not_called()

    def test_drops_only_its_scratch_database_when_sql_execution_fails(self):
        commands = []

        def run(command, **options):
            commands.append(command)
            if 'input' in options:
                raise subprocess.CalledProcessError(1, command, stderr='Fixture failure')
            return subprocess.CompletedProcess(command, 0)

        with patch('sys.argv', ['runner', '--container', 'supabase_db_notification_fixture']), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(subprocess.CalledProcessError):
                RUNNER.main()

        self.assertIn('dropdb', commands[-1])
        self.assertEqual(commands[0][-1], commands[-1][-1])


if __name__ == '__main__':
    unittest.main()
