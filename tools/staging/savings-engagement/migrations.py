#!/usr/bin/env python3
"""Safely rehearse or apply the pinned savings-engagement staging migrations."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Sequence


CONTAINER = 'baci-isolated-savings-db-1'
DATABASE = 'postgres'
SYSTEM_IDENTIFIER = '7685292944002592802'
LOCK_KEY_1 = 75612904
LOCK_KEY_2 = 1300
COUNT_MARKER = 'SAVINGS_ENGAGEMENT_COUNTS='
CHECK_MARKER = 'SAVINGS_ENGAGEMENT_CHECK_ROLLED_BACK'
APPLY_MARKER = 'SAVINGS_ENGAGEMENT_APPLIED'
NOOP_MARKER = 'SAVINGS_ENGAGEMENT_ALREADY_APPLIED'


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    filename: str
    sha256: str
    sql: str


PINNED_MIGRATIONS = (
    ('20260925130000', 'customer_savings_engagement_storage', '20260925130000_customer_savings_engagement_storage.sql', 'beeba5f07442c7bc5acfd5850f628038aeae850a940eb4d23b4da8236638a600'),
    ('20260925130100', 'customer_savings_engagement_events', '20260925130100_customer_savings_engagement_events.sql', 'd72b0e77db5a80b2b596ebc9ac6704329f3cd1ea3bcd8a15f6a86e9c5f2cf441'),
    ('20260925130200', 'customer_savings_engagement_delivery', '20260925130200_customer_savings_engagement_delivery.sql', '8f5425c0b57dac519ae264a6f3cd13e2ac99ee407b27cb21ce513b1afda1787c'),
    ('20260925130300', 'customer_savings_notification_receipts', '20260925130300_customer_savings_notification_receipts.sql', 'f953cf30c62b070991c0e5261cecdeef9ccd0692c97796587bdf1b419e04daf4'),
)


class MigrationError(RuntimeError):
    pass


def load_migrations(repository_root: Path) -> tuple[Migration, ...]:
    migrations = []
    for version, name, filename, expected_hash in PINNED_MIGRATIONS:
        source = repository_root / 'supabase' / 'migrations' / filename
        try:
            raw = source.read_bytes()
            text = raw.decode('utf-8')
        except (OSError, UnicodeDecodeError) as error:
            raise MigrationError('Pinned migration file is unavailable') from error
        actual_hash = hashlib.sha256(raw).hexdigest()
        if actual_hash != expected_hash:
            raise MigrationError('Pinned migration hash mismatch')
        if not text.startswith('BEGIN;\n') or not text.endswith('COMMIT;\n'):
            raise MigrationError('Migration transaction envelope mismatch')
        migrations.append(
            Migration(version, name, filename, expected_hash, text[7:-8])
        )
    return tuple(migrations)


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _expected_rows(migrations: Sequence[Migration]) -> str:
    rows = []
    for migration in migrations:
        statements = f'ARRAY[{_literal(migration.sql)}]::text[]'
        rows.append(
            f'({_literal(migration.version)}, {_literal(migration.name)}, {statements})'
        )
    return ',\n      '.join(rows)


def _preflight(migrations: Sequence[Migration]) -> str:
    versions = ', '.join(_literal(item.version) for item in migrations)
    public_routines = (
        'public.get_customer_savings_earnings(uuid)',
        'public.get_customer_savings_notifications(uuid)',
        'public.update_customer_savings_notification_preferences(uuid,jsonb)',
        'public.mark_customer_savings_notification_read(uuid,uuid)',
    )
    routine_collisions = ' OR '.join(
        f'to_regprocedure({_literal(routine)}) IS NOT NULL'
        for routine in public_routines
    )
    trigger_names = "'customer_savings_engagement_contribution', 'customer_savings_engagement_interest'"
    expected_rows = _expected_rows(migrations)
    return f'''DO $savings_engagement_preflight$
DECLARE
  migration_count integer;
  distinct_version_count integer;
  exact_version_count integer;
BEGIN
  IF current_database() <> '{DATABASE}' THEN
    RAISE EXCEPTION 'Wrong staging database';
  END IF;
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '{SYSTEM_IDENTIFIER}' THEN
    RAISE EXCEPTION 'Wrong staging database identity';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong database execution role';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
        AND ((column_name IN ('version', 'name') AND data_type = 'text')
          OR (column_name = 'statements' AND data_type = 'ARRAY' AND udt_name = '_text'))) <> 3 THEN
    RAISE EXCEPTION 'Unexpected migration history shape';
  END IF;
  SELECT count(*), count(DISTINCT history.version),
    count(DISTINCT history.version) FILTER (
      WHERE history.name = expected.name AND history.statements = expected.statements
    )
    INTO migration_count, distinct_version_count, exact_version_count
  FROM supabase_migrations.schema_migrations AS history
  JOIN (VALUES
      {expected_rows}
  ) AS expected(version, name, statements) ON history.version = expected.version;
  IF migration_count NOT IN (0, {len(migrations)})
    OR distinct_version_count <> migration_count THEN
    RAISE EXCEPTION 'Partial migration history';
  END IF;
  IF migration_count = {len(migrations)} AND exact_version_count <> {len(migrations)} THEN
    RAISE EXCEPTION 'Migration history content mismatch';
  END IF;
  IF migration_count = 0 AND (
    to_regnamespace('savings_notifications') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_savings_notifications_worker')
    OR ({routine_collisions})
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgname IN ({trigger_names}))
  ) THEN
    RAISE EXCEPTION 'Savings notification schema collision';
  END IF;
END
$savings_engagement_preflight$;
'''


def build_script(migrations: Sequence[Migration], mode: str) -> str:
    if mode not in ('check', 'apply'):
        raise MigrationError('Unsupported migration mode')
    pieces = [
        'BEGIN;',
        f'SELECT pg_catalog.pg_advisory_xact_lock({LOCK_KEY_1}, {LOCK_KEY_2});',
        _preflight(migrations),
        "SELECT " + _literal(COUNT_MARKER) + " || "
        "(SELECT count(*)::text FROM public.merchants) || '|' || "
        "(SELECT count(*)::text FROM public.customers) || '|' || "
        "(SELECT count(*)::text FROM auth.users) || '|' || "
        "(SELECT count(*)::text FROM public.customer_savings_goals) || '|' || "
        "(SELECT count(*)::text FROM public.push_tokens) || '|' || "
        "(SELECT count(*)::text FROM piggyvest_savings_ledger.operations) "
        "AS savings_engagement_counts \\gset",
        "SELECT CASE WHEN count(*) = 0 THEN 'true' ELSE 'false' END AS savings_engagement_apply "
        "FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY["
        + ', '.join(_literal(item.version) for item in migrations)
        + "]) \\gset",
        "\\if :savings_engagement_apply",
    ]
    for migration in migrations:
        pieces.extend(
            [
                migration.sql,
                'INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('
                f'{_literal(migration.version)}, {_literal(migration.name)}, '
                f'ARRAY[{_literal(migration.sql)}]::text[]);',
            ]
        )
    pieces.append('\\echo ' + (CHECK_MARKER if mode == 'check' else APPLY_MARKER))
    pieces.extend(['\\else', '\\echo ' + NOOP_MARKER, '\\endif'])
    pieces.append('ROLLBACK;' if mode == 'check' else 'COMMIT;')
    pieces.append('\\echo :savings_engagement_counts')
    return '\n'.join(pieces) + '\n'


def _parse_counts(output: str) -> tuple[int, ...]:
    rows = [line[len(COUNT_MARKER):] for line in output.splitlines() if line.startswith(COUNT_MARKER)]
    if len(rows) != 1 or not re.fullmatch(r'\d+(?:\|\d+){5}', rows[0]):
        raise MigrationError('Safe staging count check failed')
    return tuple(int(value) for value in rows[0].split('|'))


def _require_local_docker(
    runner: Callable[..., subprocess.CompletedProcess[str]],
) -> None:
    context_name = os.environ.get('DOCKER_CONTEXT')
    override = os.environ.get('DOCKER_HOST')
    if override is not None:
        if not override.startswith(('unix:///', 'npipe://')):
            raise MigrationError('Non-local Docker endpoint refused')
        if context_name is None:
            return
    try:
        if context_name is None:
            context = runner(
                ['docker', 'context', 'show'],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if context.returncode != 0:
                raise MigrationError('Local Docker context could not be verified')
            context_name = context.stdout.strip()
        if not context_name or any(char.isspace() for char in context_name):
            raise MigrationError('Local Docker context could not be verified')
        endpoint = runner(
            [
                'docker',
                'context',
                'inspect',
                '--format',
                '{{json .Endpoints.docker}}',
                context_name,
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        details = json.loads(endpoint.stdout) if endpoint.returncode == 0 else {}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise MigrationError('Local Docker endpoint could not be verified') from error
    host = details.get('Host') if isinstance(details, dict) else None
    if not isinstance(host, str) or not host.startswith(('unix:///', 'npipe://')):
        raise MigrationError('Non-local Docker endpoint refused')


def execute(
    mode: str,
    repository_root: Path,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> tuple[str, tuple[int, ...]]:
    migrations = load_migrations(repository_root)
    script = build_script(migrations, mode)
    _require_local_docker(runner)
    command = [
        'docker', 'exec', '-i', '-u', 'postgres', CONTAINER, 'psql', '-X', '-q',
        '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', DATABASE, '-A', '-t',
    ]
    try:
        result = runner(
            command,
            input=script,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MigrationError('Staging migration command failed') from error
    if result.returncode != 0:
        raise MigrationError('Staging migration preflight or transaction failed')
    if NOOP_MARKER in result.stdout.splitlines():
        state = 'already-applied'
    elif mode == 'check' and CHECK_MARKER in result.stdout.splitlines():
        state = 'checked-rolled-back'
    elif mode == 'apply' and APPLY_MARKER in result.stdout.splitlines():
        state = 'applied'
    else:
        raise MigrationError('Staging migration result was not confirmed')
    return state, _parse_counts(result.stdout)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true', help='rehearse in a rolled-back transaction')
    modes.add_argument('--apply', action='store_true', help='apply all pinned migrations atomically')
    arguments = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[3]
    try:
        state, counts = execute('check' if arguments.check else 'apply', root)
    except MigrationError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f'Staging migration state: {state}')
    print(
        'Safe staging row counts: merchants={}, customers={}, auth_users={}, goals={}, '
        'push_tokens={}, ledger_operations={}'.format(*counts)
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
