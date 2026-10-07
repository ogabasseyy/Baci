import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


SYSTEM_IDENTIFIER = '7685292944002592802'
APPROVED_SQL_SHA256 = '1e8ec01bc0d2bafaa720373cbba1c87c426b087659d6f657117d8068776413be'
DEADLINE = datetime(2026, 9, 29, 15, 59, 10, tzinfo=timezone.utc)
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
               'LANG': 'C', 'LC_ALL': 'C'}
COMMAND = ['/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1',
           '/usr/bin/psql', '-X', '--set=ON_ERROR_STOP=1', '--quiet',
           '--tuples-only', '--no-align', '-U', 'postgres', '-d', 'postgres']
POSTFLIGHT = """BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SELECT json_build_object(
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'checkoutFunctions',(SELECT count(*) FROM pg_proc function JOIN pg_namespace namespace
  ON namespace.oid=function.pronamespace WHERE namespace.nspname='prefunded_card'
  AND (function.proname,replace(oidvectortypes(function.proargtypes),' ','')) IN (
   ('checkout_capability','jsonb,uuid,uuid,uuid,bigint'),
   ('checkout_reserve','jsonb,jsonb'),('checkout_read','jsonb,jsonb'),
   ('checkout_claim_initialization','jsonb,jsonb'),
   ('checkout_complete_initialization','jsonb,jsonb,jsonb,jsonb'),
   ('checkout_mark_initialization_uncertain','jsonb,jsonb,jsonb'),
   ('checkout_promote_collection','jsonb,jsonb,jsonb'),
   ('checkout_flag_reconciliation','jsonb,jsonb'),
   ('checkout_recovery_candidates','jsonb,jsonb,integer'))),
 'executorRoles',(SELECT count(*) FROM pg_roles WHERE rolname IN
  ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')),
 'unsafeRoles',(SELECT count(*) FROM pg_roles WHERE rolname IN
  ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')
  AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)),
 'operations',(SELECT count(*) FROM prefunded_card.operations),
 'treasuryBindings',(SELECT count(*) FROM prefunded_card.treasury_bindings),
 'checkoutIntents',(SELECT count(*) FROM prefunded_card.checkout_intents)
);
ROLLBACK;
"""


class Refused(RuntimeError):
    def __init__(self, reason, checks=None):
        super().__init__(reason)
        self.checks = checks or []


def validate_file(metadata):
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o400 or metadata.st_nlink != 1
            or not 0 < metadata.st_size <= 2_000_000):
        raise Refused('unsafe_bundle_file')


def read_sql(selected, expected_sha256):
    if not re.fullmatch('[a-f0-9]{64}', expected_sha256):
        raise Refused('invalid_sql_pin')
    try:
        descriptor = os.open(selected, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            validate_file(os.fstat(handle.fileno()))
            contents = handle.read(2_000_001)
    except OSError as error:
        raise Refused('unreadable_bundle_file') from error
    if len(contents) > 2_000_000 or hashlib.sha256(contents).hexdigest() != expected_sha256:
        raise Refused('sql_pin_mismatch')
    try:
        return contents.decode('utf-8')
    except UnicodeDecodeError as error:
        raise Refused('invalid_sql_encoding') from error


def execute_sql(sql, run=subprocess.run):
    try:
        result = run(COMMAND, input=sql, capture_output=True, text=True,
                     timeout=180, check=False, env=ENVIRONMENT)
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused('database_command_incomplete') from error
    if result.returncode:
        checks = sorted(set(re.findall(
            r'foundation_(?:missing|conflict):[a-z_][a-z_0-9]{0,62}'
            r'(?:\.[a-z_][a-z_0-9]{0,62}){0,2}', result.stderr[:16_384])))[:40]
        raise Refused('database_apply_failed', checks)
    return result.stdout


def verify_result(result):
    expected = {'systemIdentifier': SYSTEM_IDENTIFIER, 'checkoutFunctions': 9,
                'executorRoles': 3, 'unsafeRoles': 0, 'operations': 0,
                'treasuryBindings': 0, 'checkoutIntents': 0}
    if result != expected:
        raise Refused('postflight_incomplete_do_not_retry_blindly')


def install(directory, expected_sha256):
    if os.geteuid() != 0:
        raise Refused('root_required')
    if (not re.fullmatch('[a-f0-9]{64}', APPROVED_SQL_SHA256)
            or expected_sha256 != APPROVED_SQL_SHA256):
        raise Refused('unapproved_sql_pin')
    if datetime.now(timezone.utc) >= DEADLINE:
        raise Refused('staging_deadline_expired')
    if not re.fullmatch(r'/root/baci-prefunded-foundation\.[A-Za-z0-9]{8,}', str(directory)):
        raise Refused('unapproved_root_directory')
    for ancestor in [directory, Path('/root'), Path('/')]:
        metadata = ancestor.lstat()
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
                or stat.S_IMODE(metadata.st_mode) & 0o022):
            raise Refused('unsafe_bundle_directory')
    sql = read_sql(directory / 'foundation.sql', expected_sha256)
    print(json.dumps({'stage': 'foundation-apply', 'sqlSha256': expected_sha256}), flush=True)
    execute_sql(sql)
    print(json.dumps({'stage': 'foundation-committed', 'paymentsEnabled': False}), flush=True)
    try:
        result = json.loads(execute_sql(POSTFLIGHT).strip())
    except (json.JSONDecodeError, Refused) as error:
        raise Refused('postflight_incomplete_do_not_retry_blindly') from error
    verify_result(result)
    return {'status': 'foundation_installed_inactive', 'database': result,
            'expiresAt': DEADLINE.isoformat().replace('+00:00', 'Z'),
            'paymentsEnabled': False, 'servicesStarted': False,
            'sqlSha256': expected_sha256}


def main():
    parser = argparse.ArgumentParser(description='Install the isolated, inactive card foundation.')
    parser.add_argument('--install', action='store_true', required=True)
    parser.add_argument('--sql-sha256', required=True)
    options = parser.parse_args()
    try:
        result = install(Path(__file__).absolute().parent, options.sql_sha256)
    except Refused as error:
        print(json.dumps({'status': 'refused', 'reason': str(error),
                          'checks': error.checks, 'redacted': True}))
        return 1
    except (OSError, ValueError):
        print(json.dumps({'status': 'refused', 'reason': 'owner_io_failed', 'redacted': True}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
