import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import subprocess
import threading
import shutil
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
        """Capture SQL and subprocess calls while simulating a disposable Docker DB."""
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

    def test_owned_temp_postgres_runs_the_same_sql_suites_without_docker(self):
        statements = []
        commands = []
        claims = 0

        def run(command, **options):
            nonlocal claims
            commands.append(command)
            if command[0] == '/opt/pg/bin/pg_ctl' and 'start' in command:
                data = Path(command[command.index('-D') + 1])
                data.mkdir(parents=True, exist_ok=True)
                (data / 'postmaster.pid').write_text('12345\n')
            if command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command:
                (Path(command[command.index('-D') + 1]) / 'postmaster.pid').unlink(missing_ok=True)
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

        with patch('sys.argv', ['runner', '--owned-temp-postgres', '--postgres-bin', '/opt/pg/bin']), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()):
            RUNNER.main()

        self.assertTrue(any(command[0] == '/opt/pg/bin/initdb' for command in commands))
        start = next(command for command in commands
                     if command[0] == '/opt/pg/bin/pg_ctl' and 'start' in command)
        options = start[start.index('-o') + 1]
        socket_path = options.split('-k ', 1)[1].split(' -h', 1)[0]
        self.assertLessEqual(len(socket_path) + len('/.s.PGSQL.65535'), 103)
        self.assertIn("-h ''", options)
        self.assertTrue(any(command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command for command in commands))
        self.assertFalse(any(command[0] == 'docker' for command in commands))
        self.assertIn((MIGRATIONS / 'tests/customer_savings_engagement.sql').read_text(), statements)
        self.assertIn((MIGRATIONS / 'tests/finish_push_unregistered.sql').read_text(), statements)

    def test_owned_temp_postgres_scrubs_pg_environment_and_bounds_child_commands(self):
        options_seen = []
        claims = 0
        lock = threading.Lock()

        def run(command, **options):
            nonlocal claims
            options_seen.append((command, options))
            if command[0] == '/opt/pg/bin/pg_ctl' and 'start' in command:
                data = Path(command[command.index('-D') + 1])
                data.mkdir(parents=True, exist_ok=True)
                (data / 'postmaster.pid').write_text('12345\n')
            if command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command:
                (Path(command[command.index('-D') + 1]) / 'postmaster.pid').unlink(missing_ok=True)
            source = options.get('input', '')
            with lock:
                if source == 'SELECT count(*) FROM savings_notifications.claim_push(1);':
                    claims += 1
                    output = '1' if claims == 1 else '0'
                elif "WHERE status='dispatching'" in source:
                    output = '1'
                else:
                    output = '0'
            return subprocess.CompletedProcess(command, 0, stdout=output)

        inherited = {
            'PGHOST': 'staging.invalid',
            'PGHOSTADDR': '192.0.2.9',
            'PGSERVICE': 'shared-staging',
            'PGSERVICEFILE': '/tmp/staging-service.conf',
            'PGOPTIONS': '-c role=service_role',
            'PGPASSWORD': 'must-not-leak',
        }
        with patch.dict('os.environ', inherited), \
                patch('sys.argv', ['runner', '--owned-temp-postgres', '--postgres-bin', '/opt/pg/bin']), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()):
            RUNNER.main()

        pg_commands = [options for command, options in options_seen if command[0].startswith('/opt/pg/bin/')]
        self.assertTrue(pg_commands)
        for options in pg_commands:
            self.assertTrue(all(not key.startswith('PG') for key in options['env']))
            self.assertGreater(options['timeout'], 0)

    def test_owned_temp_postgres_preserves_directory_when_stop_fails(self):
        private_root = Path(tempfile.mkdtemp(prefix='savings-pg-stop-failure-'))
        self.addCleanup(shutil.rmtree, private_root, ignore_errors=True)
        commands = []
        claims = 0
        lock = threading.Lock()

        def run(command, **options):
            nonlocal claims
            commands.append(command)
            if command[0] == '/opt/pg/bin/pg_ctl' and 'start' in command:
                data = Path(command[command.index('-D') + 1])
                data.mkdir(parents=True, exist_ok=True)
                (data / 'postmaster.pid').write_text('12345\n')
            if command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command:
                raise subprocess.CalledProcessError(1, command, stderr='stop failed')
            source = options.get('input', '')
            with lock:
                if source == 'SELECT count(*) FROM savings_notifications.claim_push(1);':
                    claims += 1
                    output = '1' if claims == 1 else '0'
                elif "WHERE status='dispatching'" in source:
                    output = '1'
                else:
                    output = '0'
            return subprocess.CompletedProcess(command, 0, stdout=output)

        stderr = io.StringIO()
        with patch('sys.argv', ['runner', '--owned-temp-postgres', '--postgres-bin', '/opt/pg/bin']), \
                patch.object(RUNNER.tempfile, 'mkdtemp', return_value=str(private_root)), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            with self.assertRaises(RuntimeError):
                RUNNER.main()

        self.assertTrue(private_root.exists())
        self.assertIn('preserving private PostgreSQL directory', stderr.getvalue())
        self.assertIn(str(private_root), stderr.getvalue())

    def test_start_timeout_without_pid_preserves_directory_if_stop_is_unconfirmed(self):
        private_root = Path(tempfile.mkdtemp(prefix='savings-pg-start-timeout-'))
        self.addCleanup(shutil.rmtree, private_root, ignore_errors=True)
        commands = []

        def run(command, **_options):
            commands.append(command)
            if command[0] == '/opt/pg/bin/pg_ctl' and 'start' in command:
                raise subprocess.TimeoutExpired(command, 45)
            if command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command:
                data = Path(command[command.index('-D') + 1])
                self.assertFalse((data / 'postmaster.pid').exists())
                raise subprocess.CalledProcessError(1, command, stderr='server state unknown')
            return subprocess.CompletedProcess(command, 0)

        stderr = io.StringIO()
        with patch('sys.argv', ['runner', '--owned-temp-postgres', '--postgres-bin', '/opt/pg/bin']), \
                patch.object(RUNNER.tempfile, 'mkdtemp', return_value=str(private_root)), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            with self.assertRaises(subprocess.TimeoutExpired):
                RUNNER.main()

        self.assertTrue(any('stop' in command for command in commands))
        self.assertTrue(private_root.exists())
        self.assertIn(str(private_root), stderr.getvalue())

    def test_existing_fixture_supplies_the_base_rows_required_by_finish_push_suite(self):
        """Keep fixture columns consumed by the migration contracts explicit."""
        fixture = (MIGRATIONS / 'tests/customer_savings_engagement.fixture.sql').read_text()

        for required in (
            'CREATE TABLE auth.users',
            'email text',
            'CREATE TABLE public.products',
            'product_id uuid',
            'platform text',
        ):
            self.assertIn(required, fixture)
        goals = fixture.split('CREATE TABLE public.customer_savings_goals', 1)[1].split(
            'CREATE TABLE public.customer_savings_contributions', 1
        )[0]
        tokens = fixture.split('CREATE TABLE public.push_tokens', 1)[1].split(
            'CREATE SCHEMA piggyvest_staging', 1
        )[0]
        self.assertIn('source_mode text', goals)
        self.assertIn('merchant_id uuid NOT NULL REFERENCES public.merchants(id)', tokens)

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
        self.assertLess(positions[-1], statements.index(legacy))
        unregistered = (MIGRATIONS / 'tests/finish_push_unregistered.sql').read_text()
        self.assertGreater(statements.index(unregistered), positions[3])
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
