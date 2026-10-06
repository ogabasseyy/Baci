import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from checkout_retirement_contract import render_transaction, snapshot_sql, validate
from checkout_retirement_diagnostic import failure_diagnostic
from checkout_retirement_patches import definitions
from checkout_retirement_provider import active_configuration, verify_unconfirmed
from checkout_retirement_state_diagnostic import annotate_state, safe_details
from public_app_upgrade import OLD_MANIFEST_SHA256
from runtime_owner_support import DOCKER, probe
from treasury_owner_contract import CONTAINER, DEADLINE_EPOCH, ENVIRONMENT, PSQL, Refused
from treasury_owner_io import private_directory, root_ancestors


PREFIX = 'BACI_RETIREMENT_CHECK:'


def annotate(sql, directory):
    markers = [
        ('identity', 'DO $identity$'), ('locks', 'LOCK TABLE '),
        ('baseline', 'DO $baseline$'),
        ('schema', 'ALTER TABLE prefunded_card.operations ADD COLUMN checkout_retired'),
        ('retirement-function', 'CREATE FUNCTION prefunded_card.retire_unconfirmed_checkout('),
        ('retirement-state', 'SELECT prefunded_card.retire_unconfirmed_checkout('),
        ('postflight', 'DO $postflight$'), ('rollback', 'ROLLBACK;'),
    ]
    if not sql.startswith('BEGIN;') or not sql.endswith('ROLLBACK;'):
        raise Refused('Rollback-only diagnostic required')
    sql = annotate_state(sql, directory)
    labels = [label for label, _ in markers]
    for label, token in markers:
        if sql.count(token) != 1:
            raise Refused('Diagnostic transaction shape differs')
        sql = sql.replace(token, '\\echo ' + PREFIX + label + '\n' + token)
    pieces = sql.split('DO $retirement_patch$')
    functions = definitions(directory)
    if len(pieces) != len(functions) + 1:
        raise Refused('Diagnostic patch count differs')
    sql = pieces[0]
    for position, piece in enumerate(pieces[1:]):
        label = 'function-' + functions[position][0].split('(')[0]
        labels.append(label)
        sql += '\\echo ' + PREFIX + label + '\nDO $retirement_patch$' + piece
    return sql + '\n\\echo ' + PREFIX + 'rolled-back\n', frozenset([*labels, 'rolled-back'])


def function_metadata(directory):
    values = []
    for signature, body, _, _, definer in definitions(directory):
        digest = hashlib.sha256(body.encode()).hexdigest()
        values.append(f"('{signature}','{digest}',{str(definer).lower()})")
    return probe(f"""SELECT jsonb_agg(jsonb_build_object(
      'function',expected.signature,'present',routine.oid IS NOT NULL,
      'bodyMatches',coalesce(encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')=expected.digest,false),
      'ownerMatches',coalesce(routine.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres'),false),
      'definerMatches',coalesce(routine.prosecdef=expected.definer,false),
      'configurationMatches',coalesce(routine.proconfig=ARRAY['search_path=pg_catalog']::text[],false),
      'languageMatches',coalesce(routine.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql'),false),
      'actualBodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')
    ) ORDER BY expected.signature)
    FROM (VALUES {','.join(values)}) expected(signature,digest,definer)
    LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure('prefunded_card.'||expected.signature);""")


def safe_result(result, labels):
    seen = [line[len(PREFIX):] for line in result.stdout.splitlines()
            if line.startswith(PREFIX) and line[len(PREFIX):] in labels]
    match = re.search(r'^ERROR:\s+([A-Z0-9]{5})(?::|\s*$)', result.stderr, re.MULTILINE)
    return dict(status='rolled-back' if result.returncode == 0 and seen and seen[-1] == 'rolled-back' else 'refused',
                failedCheck=seen[-1] if seen else 'database-command',
                sqlState=match[1] if match else None, exitCode=result.returncode, **safe_details(result.stderr))


def execute(directory):
    if os.geteuid() != 0 or time.time() >= DEADLINE_EPOCH:
        raise Refused('Root execution before the existing deadline required')
    root_ancestors(directory)
    private_directory(directory)
    print(json.dumps(dict(stage='read-only-snapshot')), flush=True)
    before = probe(snapshot_sql())
    validate(before)
    print(json.dumps(dict(stage='function-baselines', readOnly=True,
                          functions=function_metadata(directory))), flush=True)
    print(json.dumps(dict(stage='mounted-configuration-verification')), flush=True)
    secret, configuration = active_configuration(OLD_MANIFEST_SHA256)
    print(json.dumps(dict(stage='existing-reference-verification')), flush=True)
    evidence = verify_unconfirmed(secret, configuration)
    sql, labels = annotate(render_transaction(directory, before, evidence, rehearsal=True), directory)
    arguments = [*DOCKER, 'exec', '-i', CONTAINER, PSQL, '-XqAt', '-v', 'ON_ERROR_STOP=1',
                 '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres']
    print(json.dumps(dict(stage='rollback-only-rehearsal')), flush=True)
    result = subprocess.run(arguments, input=sql, text=True, capture_output=True,
                            timeout=60, env=ENVIRONMENT)
    report = safe_result(result, labels)
    after = probe(snapshot_sql())
    report.update(stage='rollback-only-rehearsal', databaseApplied=False,
                  protectedStateUnchanged=after.get('protected') == before['protected'],
                  snapshotUnchanged=after == before, newPaymentStarted=False,
                  serviceChanges=False, leaseChanged=False)
    print(json.dumps(report), flush=True)
    return report


def main(directory):
    try:
        report = execute(Path(directory))
    except Exception as error:
        print(json.dumps(dict(status='diagnostic-refused', redacted=True,
                              newPaymentStarted=False, databaseApplied=False,
                              **failure_diagnostic(error))), flush=True)
        raise SystemExit(1) from None
    if (report['status'] != 'rolled-back' or report['snapshotUnchanged'] is not True
            or report['protectedStateUnchanged'] is not True):
        raise SystemExit(1)
