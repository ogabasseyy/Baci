#!/usr/bin/env python3
"""Root-only, redacted metadata diagnosis for prefunded-card staging."""

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable


CONTAINER = 'baci-isolated-savings-db-1'
EXPECTED_SYSTEM_IDENTIFIER = '7685292944002592802'
CLEARED_ENV = {
    'HOME': '/root',
    'LANG': 'C',
    'LC_ALL': 'C',
    'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
}
EXECUTOR_ROLES = (
    'prefunded_treasury_ledger_worker',
    'prefunded_card_authorization_reader',
    'prefunded_card_authorization_provisioner',
    'prefunded_treasury_operator',
    'prefunded_authorizer',
    'prefunded_evidence',
)
CHECKOUT_BASELINE_FUNCTIONS = (
    ('checkout_reserve', 'jsonb,jsonb'),
    ('checkout_read', 'jsonb,jsonb'),
    ('checkout_claim_initialization', 'jsonb,jsonb'),
    ('checkout_complete_initialization', 'jsonb,jsonb,jsonb,jsonb'),
    ('checkout_mark_initialization_uncertain', 'jsonb,jsonb,jsonb'),
    ('checkout_promote_collection', 'jsonb,jsonb,jsonb'),
    ('checkout_flag_reconciliation', 'jsonb,jsonb'),
)
CHECKOUT_CAPABILITY_FUNCTION = ('checkout_capability', 'jsonb,uuid,uuid,uuid,bigint')
CHECKOUT_FUNCTIONS = (*CHECKOUT_BASELINE_FUNCTIONS, CHECKOUT_CAPABILITY_FUNCTION)
MEMBERSHIPS = (
    ('prefunded_treasury_ledger_worker', 'prefunded_treasury_operator'),
    ('prefunded_card_authorization_reader', 'prefunded_treasury_operator'),
    ('prefunded_card_authorization_provisioner', 'prefunded_authorizer'),
)
KNOWN_CONFIGS = {
    'gatewayBinding': Path('/etc/baci-savings-gateway/binding.json'),
    'gatewayUnit': Path('/etc/systemd/system/baci-savings-gateway.service'),
}


class Refused(RuntimeError):
    pass


def _query(sql: str, run: Callable[..., object]) -> str:
    arguments = [
        '/usr/bin/docker',
        'exec',
        '-i',
        CONTAINER,
        '/usr/bin/psql',
        '-X',
        '--set=ON_ERROR_STOP=1',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '-U',
        'postgres',
        '-d',
        'postgres',
    ]
    try:
        result = run(
            arguments,
            input=sql,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
            env=CLEARED_ENV,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused('isolated database metadata is unavailable') from error
    if result.returncode:
        raise Refused('isolated database metadata is unavailable')
    return result.stdout


def _system_identifier(run: Callable[..., object]) -> str:
    output = _query(
        'BEGIN TRANSACTION READ ONLY;\n'
        'SELECT system_identifier::text FROM pg_catalog.pg_control_system();\n'
        'ROLLBACK;\n',
        run,
    )
    values = [line.strip() for line in output.splitlines() if line.strip()]
    if len(values) != 1 or values[0] != EXPECTED_SYSTEM_IDENTIFIER:
        raise Refused('isolated database system identifier mismatch')
    return values[0]


def _metadata_sql() -> str:
    names = ','.join(repr(name) for name, _ in CHECKOUT_FUNCTIONS)
    roles = ','.join(repr(role) for role in EXECUTOR_ROLES)
    parents = ','.join(repr(parent) for parent, _ in MEMBERSHIPS)
    members = ','.join(repr(member) for _, member in MEMBERSHIPS)
    return f"""BEGIN TRANSACTION READ ONLY;
WITH scope AS (
  SELECT system_identifier::text AS system_identifier
  FROM pg_catalog.pg_control_system()
)
SELECT 'system_identifier|' || system_identifier FROM scope
UNION ALL
SELECT 'schema|' || (to_regnamespace('prefunded_card') IS NOT NULL)::text
FROM scope WHERE scope.system_identifier = '{EXPECTED_SYSTEM_IDENTIFIER}'
UNION ALL
SELECT 'function|' || p.proname || '|' || replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '')
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN scope
WHERE scope.system_identifier = '{EXPECTED_SYSTEM_IDENTIFIER}'
  AND n.nspname = 'prefunded_card' AND p.proname IN ({names})
UNION ALL
SELECT 'role|' || rolname || '|' || rolcanlogin::text
FROM pg_catalog.pg_roles CROSS JOIN scope
WHERE scope.system_identifier = '{EXPECTED_SYSTEM_IDENTIFIER}' AND rolname IN ({roles})
UNION ALL
SELECT 'membership|' || parent.rolname || '|' || member.rolname
FROM pg_catalog.pg_auth_members membership
JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
JOIN pg_catalog.pg_roles member ON member.oid = membership.member
CROSS JOIN scope
WHERE scope.system_identifier = '{EXPECTED_SYSTEM_IDENTIFIER}'
  AND parent.rolname IN ({parents}) AND member.rolname IN ({members});
ROLLBACK;
"""


def _parse_metadata(output: str) -> dict[str, object]:
    system_identifier = None
    schema = None
    functions: set[tuple[str, str]] = set()
    roles: set[tuple[str, bool]] = set()
    memberships: set[tuple[str, str]] = set()
    for line in output.splitlines():
        parts = line.strip().split('|')
        if len(parts) == 2 and parts[0] == 'system_identifier':
            system_identifier = parts[1]
        elif parts == ['schema', 'true']:
            schema = True
        elif parts == ['schema', 'false']:
            schema = False
        elif len(parts) == 3 and parts[0] == 'function':
            functions.add((parts[1], parts[2]))
        elif len(parts) == 3 and parts[0] == 'role' and parts[2] in {'true', 'false'}:
            roles.add((parts[1], parts[2] == 'true'))
        elif len(parts) == 3 and parts[0] == 'membership':
            memberships.add((parts[1], parts[2]))
        else:
            raise Refused('isolated database metadata has an invalid shape')
    if system_identifier != EXPECTED_SYSTEM_IDENTIFIER:
        raise Refused('isolated database system identifier changed during metadata query')
    if schema is None:
        raise Refused('isolated database schema metadata is unavailable')
    observed_functions = functions & set(CHECKOUT_FUNCTIONS)
    baseline_functions = observed_functions & set(CHECKOUT_BASELINE_FUNCTIONS)
    capability_present = CHECKOUT_CAPABILITY_FUNCTION in observed_functions
    if len(baseline_functions) == len(CHECKOUT_BASELINE_FUNCTIONS) and capability_present:
        baseline = 'eight_function_ready'
    elif len(baseline_functions) == len(CHECKOUT_BASELINE_FUNCTIONS):
        baseline = 'seven_function_partial'
    else:
        baseline = 'incomplete'
    return {
        'prefundedSchemaPresent': schema,
        'checkoutFunctions': [
            {'name': name, 'identityArguments': arguments}
            for name, arguments in sorted(functions)
            if (name, arguments) in observed_functions
        ],
        'checkoutCapabilityPresent': capability_present,
        'checkoutFunctionBaseline': baseline,
        'executorRoles': [
            {'name': name, 'canLogin': can_login}
            for name, can_login in sorted(roles)
            if name in EXECUTOR_ROLES
        ],
        'memberships': [
            {'role': role, 'member': member}
            for role, member in sorted(memberships)
            if (role, member) in MEMBERSHIPS
        ],
    }


def database_metadata(run: Callable[..., object] = subprocess.run) -> dict[str, object]:
    system_identifier = _system_identifier(run)
    metadata = _parse_metadata(_query(_metadata_sql(), run))
    return {'systemIdentifier': system_identifier, **metadata}


def _file_metadata(path: Path) -> dict[str, object]:
    try:
        info = path.lstat()
    except OSError:
        return {'present': False}
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        return {'present': False}
    try:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return {'present': False}
    return {
        'present': True,
        'sha256': digest,
        'mode': f'{stat.S_IMODE(info.st_mode):04o}',
        'ownerUid': info.st_uid,
    }


def _system_services(run: Callable[..., object] = subprocess.run) -> list[dict[str, str]]:
    try:
        result = run(
            ['/usr/bin/systemctl', 'list-unit-files', '--type=service', '--no-legend'],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
            env=CLEARED_ENV,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused('system service metadata is unavailable') from error
    if result.returncode:
        raise Refused('system service metadata is unavailable')
    services = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 2 and 'prefunded' in fields[0]:
            services.append({'name': fields[0], 'unitFileState': fields[1]})
    return services


def collect(run: Callable[..., object] = subprocess.run) -> dict[str, object]:
    return {
        'database': database_metadata(run),
        'prefundedSystemServices': _system_services(run),
        'knownConfig': {name: _file_metadata(path) for name, path in KNOWN_CONFIGS.items()},
        'readOnly': True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', required=True)
    arguments = parser.parse_args(argv)
    if os.geteuid() != 0:
        print('Diagnostic refused; owner-reviewed root execution is required.', file=sys.stderr)
        return 1
    try:
        result = collect()
    except Refused:
        print('Diagnostic refused; no service or database changes were made.', file=sys.stderr)
        return 1
    if arguments.check:
        print(json.dumps(result, separators=(',', ':'), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
