"""Regression tests for cleanup after interrupted PostgreSQL setup and SQL runs."""

import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import shutil
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    'savings_notifications_postgres_cleanup_runner',
    DIRECTORY / 'savings-notifications-postgres.test.py',
)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class SavingsNotificationsPostgresCleanupTests(unittest.TestCase):
    """Exercise teardown ownership boundaries without launching PostgreSQL."""

    def test_initdb_timeout_attempts_stop_and_preserves_original_error(self):
        """A timed-out initdb may leave a child, and failed stop must not mask timeout."""
        private_root = Path(tempfile.mkdtemp(prefix='savings-pg-initdb-timeout-'))
        self.addCleanup(shutil.rmtree, private_root, ignore_errors=True)
        commands = []

        def run(command, **_options):
            commands.append(command)
            if command[0] == '/opt/pg/bin/initdb':
                (private_root / 'data').mkdir()
                raise subprocess.TimeoutExpired(command, 45)
            if command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command:
                raise subprocess.CalledProcessError(1, command, stderr='stop failed')
            return subprocess.CompletedProcess(command, 0)

        stderr = io.StringIO()
        with patch('sys.argv', ['runner', '--owned-temp-postgres', '--postgres-bin', '/opt/pg/bin']), \
                patch.object(RUNNER.tempfile, 'mkdtemp', return_value=str(private_root)), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            with self.assertRaises(subprocess.TimeoutExpired):
                RUNNER.main()

        self.assertTrue(any(command[0] == '/opt/pg/bin/pg_ctl' and 'stop' in command
                            for command in commands))
        self.assertTrue(private_root.exists())
        self.assertIn(str(private_root), stderr.getvalue())

    def test_docker_forces_owned_database_drop_without_masking_primary_error(self):
        """Force termination of sessions on the generated DB and retain SQL failure."""
        commands = []
        primary = subprocess.CalledProcessError(1, ['psql'], stderr='SQL failed')

        def run(command, **options):
            commands.append(command)
            if 'input' in options:
                raise primary
            if 'dropdb' in command:
                raise subprocess.CalledProcessError(1, command, stderr='drop failed')
            return subprocess.CompletedProcess(command, 0)

        with patch('sys.argv', ['runner', '--container', 'supabase_db_notification_fixture']), \
                patch.object(RUNNER.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(subprocess.CalledProcessError) as raised:
                RUNNER.main()

        self.assertIs(raised.exception, primary)
        drop = next(command for command in commands if 'dropdb' in command)
        self.assertIn('--force', drop)
        self.assertTrue(drop[-1].startswith('baci_engagement_test_'))


if __name__ == '__main__':
    unittest.main()
