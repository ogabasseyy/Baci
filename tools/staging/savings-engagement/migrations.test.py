import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from migrations import (
    APPLY_MARKER,
    CHECK_MARKER,
    CONTAINER,
    DATABASE,
    NOOP_MARKER,
    PINNED_MIGRATIONS,
    SYSTEM_IDENTIFIER,
    MigrationError,
    build_script,
    execute,
    load_migrations,
)


ROOT = Path(__file__).resolve().parents[3]
MIGRATION_DIRECTORY = ROOT / 'supabase' / 'migrations'
COUNT_LINE = 'SAVINGS_ENGAGEMENT_COUNTS=1|1|2|1|0|0\n'


def process_result(returncode=0, marker=CHECK_MARKER, stderr=''):
    return subprocess.CompletedProcess(
        args=[],
        returncode=returncode,
        stdout=f'{marker}\n{COUNT_LINE}' if returncode == 0 else '',
        stderr=stderr,
    )


def local_docker_runner(psql_result, captured):
    def runner(command, **options):
        if command[1:3] == ['context', 'show']:
            return subprocess.CompletedProcess(command, 0, 'default\n', '')
        if command[1:3] == ['context', 'inspect']:
            return subprocess.CompletedProcess(
                command, 0, json.dumps({'Host': 'unix:///var/run/docker.sock'}), ''
            )
        captured['command'] = command
        captured['script'] = options['input']
        return psql_result

    return runner


class SavingsEngagementMigrationTests(unittest.TestCase):
    def test_pins_exact_hashes_and_strips_only_the_transaction_envelope(self):
        migrations = load_migrations(ROOT)
        self.assertEqual(len(migrations), 4)
        for migration, pin in zip(migrations, PINNED_MIGRATIONS):
            raw = (MIGRATION_DIRECTORY / migration.filename).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), pin[3])
            text = raw.decode('utf-8')
            self.assertEqual(migration.sql, text[7:-8])

    def test_refuses_migration_hash_drift_before_invoking_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / 'supabase' / 'migrations'
            target.mkdir(parents=True)
            for _, _, filename, _ in PINNED_MIGRATIONS:
                (target / filename).write_bytes((MIGRATION_DIRECTORY / filename).read_bytes())
            drifted = target / PINNED_MIGRATIONS[2][2]
            drifted.write_bytes(drifted.read_bytes() + b'-- drift\n')
            with self.assertRaisesRegex(MigrationError, 'hash mismatch'):
                load_migrations(root)

    def test_wrong_database_identity_fails_closed_without_echoing_database_error(self):
        captured = {}

        with self.assertRaisesRegex(MigrationError, 'preflight or transaction failed') as failure:
            execute(
                'check',
                ROOT,
                local_docker_runner(
                    process_result(1, stderr='wrong database identity details'),
                    captured,
                ),
            )

        self.assertNotIn('wrong database identity details', str(failure.exception))
        self.assertEqual(captured['command'][:6], ['docker', 'exec', '-i', '-u', 'postgres', CONTAINER])
        self.assertIn(f"current_database() <> '{DATABASE}'", captured['script'])
        self.assertIn(f"<> '{SYSTEM_IDENTIFIER}'", captured['script'])

    def test_partial_history_is_rejected_before_any_migration_body_runs(self):
        migrations = load_migrations(ROOT)
        script = build_script(migrations, 'apply')
        self.assertIn('migration_count NOT IN (0, 4)', script)
        self.assertIn('distinct_version_count <> migration_count', script)
        self.assertIn('exact_version_count <> 4', script)
        self.assertLess(script.index('DO $savings_engagement_preflight$'), script.index(migrations[0].sql))

        with self.assertRaisesRegex(MigrationError, 'preflight or transaction failed'):
            execute(
                'apply',
                ROOT,
                local_docker_runner(
                    process_result(1, stderr='Partial migration history'), {}
                ),
            )

    def test_apply_runs_all_four_migrations_and_history_in_one_commit(self):
        migrations = load_migrations(ROOT)
        captured = {}

        state, counts = execute(
            'apply', ROOT, local_docker_runner(process_result(marker=APPLY_MARKER), captured)
        )
        script = captured['script']

        self.assertEqual(state, 'applied')
        self.assertEqual(counts, (1, 1, 2, 1, 0, 0))
        self.assertIn('psql', captured['command'])
        self.assertIn('--dbname', captured['command'])
        self.assertEqual(script.count('INSERT INTO supabase_migrations.schema_migrations'), 4)
        self.assertEqual(script.count('CREATE SCHEMA IF NOT EXISTS savings_notifications;'), 3)
        self.assertEqual(script.count('COMMIT;'), 1)
        self.assertNotIn('ROLLBACK;', script)
        for migration in migrations:
            self.assertIn(migration.sql, script)
            self.assertIn(f"VALUES ('{migration.version}', '{migration.name}'", script)

    def test_check_rolls_back_and_exact_existing_history_is_a_noop(self):
        state, counts = execute(
            'check', ROOT, local_docker_runner(process_result(), {})
        )
        self.assertEqual(state, 'checked-rolled-back')
        self.assertEqual(counts, (1, 1, 2, 1, 0, 0))

        state, _counts = execute(
            'apply',
            ROOT,
            local_docker_runner(process_result(marker=NOOP_MARKER), {}),
        )
        self.assertEqual(state, 'already-applied')

    def test_refuses_remote_docker_endpoint_before_database_command(self):
        calls = []

        def runner(command, **_options):
            calls.append(command)
            if command[1:3] == ['context', 'show']:
                return subprocess.CompletedProcess(command, 0, 'remote\n', '')
            return subprocess.CompletedProcess(
                command, 0, json.dumps({'Host': 'ssh://staging.example'}), ''
            )

        with self.assertRaisesRegex(MigrationError, 'Non-local Docker endpoint'):
            execute('check', ROOT, runner)
        self.assertEqual(len(calls), 2)

    def test_refuses_remote_docker_host_override(self):
        with mock.patch.dict(os.environ, {'DOCKER_HOST': 'tcp://staging.example:2376'}):
            with self.assertRaisesRegex(MigrationError, 'Non-local Docker endpoint'):
                execute('check', ROOT, lambda *_args, **_kwargs: self.fail('Docker invoked'))

    def test_refuses_conflicting_remote_host_even_with_a_selected_context(self):
        with mock.patch.dict(os.environ, {'DOCKER_CONTEXT': 'default', 'DOCKER_HOST': 'tcp://other.example:2376'}):
            with self.assertRaisesRegex(MigrationError, 'Non-local Docker endpoint'):
                execute('check', ROOT, lambda *_args, **_kwargs: self.fail('Docker invoked'))


if __name__ == '__main__':
    unittest.main()
